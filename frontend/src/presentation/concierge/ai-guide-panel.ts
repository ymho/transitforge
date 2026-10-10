import { iconMarkup, setLoadingStatus } from "../shared/primitives";
import { previewPlanAdoption } from "./plan-adoption-view";
import { canCombineAccommodationPlan, renderPublicAccommodationPresentation } from "./public-accommodation-presentation-view";
import type { JourneyRouteResult } from "@raiquora/journey/direct-route-search";
import {
  type ConversationHistoryRepository,
} from "../../usecases/concierge/conversation-history-repository";
import { renderPublicPlanPresentation } from "./public-plan-presentation-view";
import { canCombineJourneyPlan, renderPublicJourneyPresentation } from "./public-journey-presentation-view";
import { renderPublicGroundRoutePresentation } from "./public-ground-route-presentation-view";
import type { PublicGroundRoutePresentation } from "@raiquora/agent/public-ground-route-presentation";
import { renderPublicPlacePresentation } from "./public-place-presentation-view";
import {
  buildConversationFeedback,
  type ConversationFeedbackV2,
} from "../../usecases/concierge/conversation-feedback";
import {
  defaultJourneySearchPreferences,
  isJourneyRankingPreference,
  isTransferPace,
  type JourneySearchPreferences,
} from "@raiquora/journey/journey-search-preferences";
import type { AssistantTurnView } from "../../domain/assistant-turn-view";
import type { AgentProgressPhase } from "@raiquora/agent/agent-progress";
import type { PublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import { hideSheet, showSheet } from "../shared/sheet-transition";
import { renderAssistantMarkdown, visibleAssistantText } from "./assistant-markdown";
import {
  loadJourneySearchPreferences,
  saveJourneySearchPreferences,
} from "./journey-preferences-storage";
import { typewriteText } from "../shared/typewriter-text";

export { visibleAssistantText } from "./assistant-markdown";
export { loadJourneySearchPreferences } from "./journey-preferences-storage";

export interface AgentResponseMetadata {
  requestId?: string;
}

export type ConversationFeedback = ConversationFeedbackV2;

export interface AiGuidePanelElements {
  conversationSessionId: string;
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  close: HTMLButtonElement;
  messages: HTMLOListElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  suggestions: HTMLButtonElement[];
  settingsToggle: HTMLButtonElement;
  settingsPanel: HTMLElement;
  transferPace: HTMLSelectElement;
  rankingPreference: HTMLSelectElement;
  storage: Storage;
  historyRepository: ConversationHistoryRepository;
  submitFeedback?: (feedback: ConversationFeedback) => Promise<void>;
  onFirstPrompt?: (prompt: string) => void;
  /** Called only after a current live response is rendered; history never triggers a reload. */
  onTripConditionsSaved?: () => void;
  onPlanPresentation?: (value: import("@raiquora/agent/public-plan-presentation").PublicPlanPresentation, open: boolean) => void;
  onTripCostProposal?: (proposal: import("@raiquora/trip/public-cost-proposal").PublicCostProposal) => void;
  onConsultationRequestProposal?: (proposal: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal) => void;
  onTripUpdateProposal?: (proposal: import("@raiquora/trip/trip").TripUpdateProposal) => void;
  placeMemoTargets?: () => readonly { key: string; label: string }[];
  onPlaceMemoProposal?: (card: import("@raiquora/agent/public-place-presentation").PublicPlaceCard,
    dayKey: string, category: import("@raiquora/trip/trip").ActivityCategory) => void;
  onPlanAdoption?: (target: { conversationId: string; candidateSetId: string; candidateSetRevision: number; variantId: string; tripId: string; baseTripRevision: number; mutationId: string }) => Promise<{
    changes: { added: number; replaced: number; removed: number }; confirm(): Promise<void>;
  }>;
  onGroundRoute?: (route: PublicGroundRoutePresentation, index: number) => void;
  persistent?: () => boolean;
  /** Host-owned explicit Trip/revision binding; no title or message inference. */
  responseContextKey?: () => string;
}

export type AiGuidePromptHandler = (
  prompt: string,
  preferences: JourneySearchPreferences,
  onResponseMetadata?: (metadata: AgentResponseMetadata) => void,
  options?: { requestedResearchMode: "standard" | "detailed"; researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number };
    onProgress?: (phase: AgentProgressPhase) => void },
) => Promise<AssistantTurnView>;

export const staleResponseNotice =
  "会話の状態が変わったため回答を表示できませんでした。もう一度お試しください。";

export interface AiGuidePanelController {
  switchSession(conversationSessionId: string): void;
  openLandmarkJourney(name: string, type?: string): void;
  open(): void;
  ask(prompt: string): void;
  notify(text: string): void;
}


export function configureAiGuidePanel(
  elements: AiGuidePanelElements,
  handlePrompt: AiGuidePromptHandler,
): AiGuidePanelController {
  const {
    panel,
    toggle,
    close,
    messages,
    form,
    input,
    submit,
    suggestions,
    settingsToggle,
    settingsPanel,
    transferPace,
    rankingPreference,
    storage,
    submitFeedback,
    historyRepository,
  } = elements;
  let conversationSessionId = elements.conversationSessionId;
  let requestGeneration = 0;
  const scrollPositions = new Map<string, number>();
  // Tab-local, per-conversation draft only; not a Trip or server writer.
  const draftKey = () => `raiquora:conversation-draft:${conversationSessionId}`;
  const saveInputDraft = () => {
    try {
      const drafts = input.ownerDocument.defaultView?.sessionStorage;
      if (input.value) drafts?.setItem(draftKey(), input.value.slice(0, 4000)); else drafts?.removeItem(draftKey());
    } catch { /* Storage denial must not disable consultation. */ }
  };
  const restoreInputDraft = () => {
    try { return input.ownerDocument.defaultView?.sessionStorage.getItem(draftKey())?.slice(0, 4000) ?? ""; }
    catch { return ""; }
  };
  input.addEventListener("input", saveInputDraft);
  const savedPreferences = loadJourneySearchPreferences(storage);
  transferPace.value = savedPreferences.transferPace;
  rankingPreference.value = savedPreferences.rankingPreference;

  const preferences = (): JourneySearchPreferences => ({
    transferPace: isTransferPace(transferPace.value)
      ? transferPace.value
      : defaultJourneySearchPreferences.transferPace,
    rankingPreference: isJourneyRankingPreference(rankingPreference.value)
      ? rankingPreference.value
      : defaultJourneySearchPreferences.rankingPreference,
    maxTransfers: 3,
  });
  const savePreferences = () => saveJourneySearchPreferences(storage, preferences());
  transferPace.addEventListener("change", savePreferences);
  rankingPreference.addEventListener("change", savePreferences);
  if (settingsPanel instanceof HTMLDialogElement) {
    settingsToggle.addEventListener("click", () => settingsPanel.showModal());
    settingsPanel.querySelector<HTMLElement>("[data-close-journey-settings]")
      ?.addEventListener("click", () => settingsPanel.close());
  } else {
    settingsToggle.addEventListener("click", () => {
      const open = settingsPanel.hidden;
      settingsPanel.hidden = !open;
      settingsToggle.ariaExpanded = String(open);
    });
  }

  const setOpen = (open: boolean) => {
    if (!open && elements.persistent?.()) {
      if (shouldFocusAiGuideInputOnOpen()) input.focus();
      return;
    }
    toggle.ariaExpanded = String(open);
    if (open) {
      showSheet(panel);
      if (shouldFocusAiGuideInputOnOpen()) {
        input.focus();
      }
    } else {
      hideSheet(panel, () => toggle.focus());
    }
  };

  toggle.addEventListener("click", () => {
    const open = toggle.ariaExpanded !== "true";
    setOpen(open);
  });
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  for (const suggestion of suggestions) {
    suggestion.addEventListener("click", () => {
      input.value = suggestion.dataset.prompt ?? suggestion.textContent ?? "";
      input.focus();
    });
  }

  messages.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-conversation-feedback]")
      : null;
    if (!target || target.disabled || !submitFeedback) return;
    const rating = target.dataset.conversationFeedback;
    if (rating !== "good" && rating !== "bad") return;
    const message = target.closest<HTMLElement>(".ai-guide-message");
    if (!message?.dataset.messageId) return;
    const send = (comment?: string, status?: HTMLElement) => {
      setFeedbackControlsDisabled(message, true);
      if (status) status.textContent = "送信中";
      let feedback: ConversationFeedback;
      try {
        feedback = buildConversationFeedback(
          conversationSessionId,
          historyRepository.list(conversationSessionId),
          message.dataset.messageId!,
          rating,
          comment,
        );
      } catch {
        setFeedbackControlsDisabled(message, false);
        const errorMessage = "この回答を評価できませんでした。会話を開き直してもう一度お試しください";
        if (status) {
          status.textContent = errorMessage;
        } else {
          message.querySelector(".conversation-feedback")
            ?.append(feedbackStatus(errorMessage));
        }
        return;
      }
      void submitFeedback!(feedback)
        .then(() => {
          target.dataset.feedbackStored = "true";
          message.querySelector(".conversation-feedback-comment")?.remove();
          if (status) {
            status.textContent = "フィードバックを送信しました";
          } else {
            message.querySelector(".conversation-feedback")
              ?.append(feedbackStatus("フィードバックを送信しました"));
          }
        })
        .catch(() => {
          setFeedbackControlsDisabled(message, false);
          if (status) status.textContent = "送信できませんでした。もう一度お試しください";
        });
    };
    if (rating === "good") {
      const status = feedbackStatus("");
      message.querySelector(".conversation-feedback")?.append(status);
      send(undefined, status);
      return;
    }
    showBadFeedbackComment(message, send);
  });

  const addProposalAction = (message: HTMLElement, response: AssistantTurnView) => {
    const consultation = response.consultationRequestProposal;
    const update = response.tripUpdateProposal;
    const review = consultation && elements.onConsultationRequestProposal
      ? () => elements.onConsultationRequestProposal?.(consultation)
      : update && elements.onTripUpdateProposal ? () => elements.onTripUpdateProposal?.(update) : undefined;
    if (!review) return;
    const button = document.createElement("button");
    button.type = "button"; button.textContent = !update || update.patches[0]?.type === "request" ? "条件の変更案を確認" : "予定の変更案を確認";
    button.addEventListener("click", review);
    message.append(button);
  };

  let hasConversationHistory = false;
  const sendPrompt = (prompt: string, requestedResearchMode: "standard" | "detailed" = "standard",
    researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number }) => {
    if (!prompt || submit.disabled) {
      return;
    }

    if (!hasConversationHistory) {
      elements.onFirstPrompt?.(prompt);
      hasConversationHistory = true;
    }
    const requestedGeneration = ++requestGeneration;
    const requestedSessionId = conversationSessionId;
    const requestedContextKey = elements.responseContextKey?.();
    const userMessage = historyRepository.append(
      requestedSessionId,
      { role: "user", text: prompt },
    );
    appendMessage(messages, "user", prompt, userMessage.messageId);
    input.value = "";
    saveInputDraft();
    input.disabled = true;
    submit.disabled = true;
    submit.ariaLabel = "送信中";
    submit.dataset.submitting = "true";
    const pendingMessage = appendPendingMessage(messages);

    let requestId: string | undefined;
    void handlePrompt(prompt, preferences(), (metadata) => {
      requestId = metadata.requestId;
    }, { requestedResearchMode, ...(researchTarget ? { researchTarget } : {}), onProgress: phase => {
      if (requestedGeneration === requestGeneration && conversationSessionId === requestedSessionId) updatePendingMessage(pendingMessage, phase);
    } })
      .then((response) => {
        if (requestedGeneration !== requestGeneration) {
          if (conversationSessionId === requestedSessionId) pendingMessage.remove();
          return;
        }
        if (requestedContextKey !== elements.responseContextKey?.()) {
          if (conversationSessionId === requestedSessionId) showStaleResponseNotice(pendingMessage);
          else pendingMessage.remove();
          return;
        }
        const assistantMessage = historyRepository.append(
          requestedSessionId,
          {
            role: "assistant",
            response,
            ...(requestId ? { requestId } : {}),
          },
        );
        if (conversationSessionId !== requestedSessionId) return;
        resolveAssistantMessage(pendingMessage, response, {
          placeMemoSelection: elements.placeMemoTargets && elements.onPlaceMemoProposal ? { days: elements.placeMemoTargets, propose: elements.onPlaceMemoProposal } : undefined,
          onGroundRoute: elements.onGroundRoute,
        });
        addProposalAction(pendingMessage, response);
        // Only a newly delivered V2 proposal opens the preview. Restoring history never reapplies it.
        if (response.consultationRequestProposal) elements.onConsultationRequestProposal?.(response.consultationRequestProposal);
        if (response.tripCostProposal && !response.tripUpdateProposal) elements.onTripCostProposal?.(response.tripCostProposal);
        if (response.tripUpdateProposal) elements.onTripUpdateProposal?.(response.tripUpdateProposal);
        if (response.publicPlanPresentation) elements.onPlanPresentation?.(response.publicPlanPresentation, !response.publicAccommodationPresentation);
        if (!submitFeedback) pendingMessage.querySelector(".conversation-feedback")?.remove();
        pendingMessage.dataset.messageId = assistantMessage.messageId;
        if (response.tripMutationReceipt) elements.onTripConditionsSaved?.();
        if (!response.publicPlanPresentation && response.semanticReceipt?.changes.some(
          change => change.status === "accepted" && change.frame === "actual")) elements.onTripConditionsSaved?.();
      })
      .catch((error: unknown) => {
        if (requestedGeneration !== requestGeneration) {
          if (conversationSessionId === requestedSessionId) pendingMessage.remove();
          return;
        }
        if (requestedContextKey !== elements.responseContextKey?.()) {
          if (conversationSessionId === requestedSessionId) showStaleResponseNotice(pendingMessage);
          else pendingMessage.remove();
          return;
        }
        const errorResponse = agentFailureMessage(error);
        const assistantMessage = historyRepository.append(requestedSessionId, {
          role: "assistant",
          response: { text: errorResponse },
          ...(requestId ? { requestId } : {}),
        });
        if (conversationSessionId !== requestedSessionId) return;
        resolveAssistantMessage(pendingMessage, { text: errorResponse });
        pendingMessage.classList.add("ai-guide-message-failure");
        const actions = document.createElement("div");
        actions.className = "ai-guide-failure-actions";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.setAttribute("aria-label", "もう一度試す");
        retry.title = "もう一度試す";
        retry.innerHTML = '<svg class="ds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5l3 5"/></svg>';
        retry.disabled = true;
        retry.addEventListener("click", () => {
          if (retry.disabled) return;
          retry.disabled = true;
          submitPrompt(prompt, requestedResearchMode, researchTarget);
        });
        actions.append(retry);
        pendingMessage.append(actions);
        if (!submitFeedback) pendingMessage.querySelector(".conversation-feedback")?.remove();
        pendingMessage.dataset.messageId = assistantMessage.messageId;
      })
      .finally(() => {
        if (requestedGeneration !== requestGeneration || conversationSessionId !== requestedSessionId) return;
        input.disabled = false;
        submit.disabled = false;
        submit.ariaLabel = "送信";
        delete submit.dataset.submitting;
        pendingMessage.querySelector<HTMLButtonElement>(".ai-guide-failure-actions button")?.removeAttribute("disabled");
        input.focus();
      });
  };

  const submitPrompt = (prompt: string, requestedResearchMode: "standard" | "detailed" = "standard", researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number }) => {
    if (!prompt || submit.disabled) return;
    sendPrompt(prompt, requestedResearchMode, researchTarget);
  };

  messages.addEventListener("raiquora:detailed-research", (event) => {
    const detail = (event as CustomEvent<{ presentationId?: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number }>).detail;
    if (!detail?.presentationId) return;
    submitPrompt("提示された案をさらに詳しく比較したい", "detailed", { presentationId: detail.presentationId,
      ...(detail.candidateSetId ? { candidateSetId: detail.candidateSetId } : {}), ...(detail.candidateSetRevision === undefined ? {} : { candidateSetRevision: detail.candidateSetRevision }),
      ...(detail.tripId ? { tripId: detail.tripId } : {}), ...(detail.baseTripRevision === undefined ? {} : { baseTripRevision: detail.baseTripRevision }) });
  });
  messages.addEventListener("raiquora:preview-plan-adoption", (event) => {
    if (!elements.onPlanAdoption) return;
    const session = conversationSessionId, generation = requestGeneration;
    previewPlanAdoption(event, { conversationId: session, adopt: elements.onPlanAdoption,
      isCurrent: () => session === conversationSessionId && generation === requestGeneration });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPrompt(input.value.trim());
  });

  const controller: AiGuidePanelController = {
    switchSession(nextConversationSessionId) {
      requestGeneration++;
      scrollPositions.set(conversationSessionId, messages.scrollTop);
      if (nextConversationSessionId !== conversationSessionId) saveInputDraft();
      conversationSessionId = nextConversationSessionId;
      input.value = restoreInputDraft();
      input.disabled = false;
      input.placeholder = "列車、行き先、旅の相談を入力";
      submit.disabled = false;
      submit.ariaLabel = "送信";
      delete submit.dataset.submitting;
      messages.replaceChildren();
      const restoredHistory = historyRepository.list(conversationSessionId);
      hasConversationHistory = restoredHistory.length > 0;
      for (const entry of restoredHistory) {
        if (entry.role === "user") {
          appendMessage(messages, "user", entry.text, entry.messageId);
          continue;
        }
        const restored = appendPendingMessage(messages, entry.messageId);
        resolveAssistantMessage(restored, entry.response, { animate: false,
          placeMemoSelection: elements.placeMemoTargets && elements.onPlaceMemoProposal ? { days: elements.placeMemoTargets, propose: elements.onPlaceMemoProposal } : undefined,
          onGroundRoute: elements.onGroundRoute,
        });
        addProposalAction(restored, entry.response);
        if (!submitFeedback) restored.querySelector(".conversation-feedback")?.remove();
      }
      const latestPlan = [...restoredHistory].reverse().find(entry => entry.role === "assistant" && entry.response.publicPlanPresentation);
      if (latestPlan?.role === "assistant" && latestPlan.response.publicPlanPresentation)
        elements.onPlanPresentation?.(latestPlan.response.publicPlanPresentation, false);
      messages.scrollTop = scrollPositions.get(conversationSessionId) ?? 0;
    },
    openLandmarkJourney(name) {
      setOpen(true);
      sendPrompt(`${name}へ旅行したい`);
    },
    open() {
      setOpen(true);
    },
    ask(prompt) { setOpen(true); submitPrompt(prompt); },
    notify(text) { const message = appendPendingMessage(messages); resolveAssistantMessage(message, { text }); },
  };
  controller.switchSession(conversationSessionId);
  return controller;
}

export function agentFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === "limit_reached") {
    return "候補の確認に時間がかかり、今回の案をまとめきれませんでした。条件は保持しています。もう一度送るか、地域・日数などを一つ加えて続けてください。";
  }
  if (error instanceof Error && error.message === "turn_conflict") {
    return "同じ相談を処理中です。少し待ってから、もう一度お試しください。";
  }
  return "案内を開始できませんでした。時間をおいてもう一度お試しください。";
}

export function shouldFocusAiGuideInputOnOpen(
  viewportWidth = window.innerWidth,
  hasCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false,
): boolean {
  return viewportWidth >= 768 && !hasCoarsePointer;
}

function appendMessage(
  messages: HTMLOListElement,
  role: "assistant" | "user",
  text: string,
  messageId?: string,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `ai-guide-message ai-guide-message-${role}`;
  item.textContent = role === "assistant" ? visibleAssistantText(text) : text;
  if (messageId) item.dataset.messageId = messageId;
  if (role === "assistant") appendConversationFeedback(item);
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

function appendPendingMessage(
  messages: HTMLOListElement,
  messageId?: string,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className =
    "ai-guide-message ai-guide-message-assistant ai-guide-message-pending";
  item.setAttribute("aria-label", "AIが回答を準備しています");
  if (messageId) item.dataset.messageId = messageId;

  const label = document.createElement("span");
  setLoadingStatus(label, "考え中", true);

  item.append(label);
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

const progressLabels: Record<AgentProgressPhase, string> = {
  running: "考え中",
  understanding_request: "相談内容を整理しています",
  checking_information: "必要な情報を確認しています",
  comparing_options: "候補を比較しています",
  building_answer: "旅行案を組み立てています",
  validating_answer: "回答内容を確認しています",
};

export function agentProgressLabel(phase: AgentProgressPhase): string { return progressLabels[phase]; }

function updatePendingMessage(item: HTMLLIElement, phase: AgentProgressPhase): void {
  const label = item.querySelector("span");
  if (label) label.textContent = agentProgressLabel(phase);
  item.setAttribute("aria-label", agentProgressLabel(phase));
}

function showStaleResponseNotice(item: HTMLLIElement): void {
  resolveAssistantMessage(item, { text: staleResponseNotice }, { animate: false });
  item.querySelector(".conversation-feedback")?.remove();
}

export function resolveAssistantMessage(
  item: HTMLLIElement,
  response: AssistantTurnView,
  options: { animate?: boolean; placeMemoSelection?: Parameters<typeof renderPublicPlacePresentation>[1];
    onGroundRoute?: (route: PublicGroundRoutePresentation, index: number) => void } = {},
): void {
  item.classList.remove("ai-guide-message-pending");
  item.removeAttribute("aria-label");
  const candidateGroups = [
    ...(response.publicJourneyPresentation ? [`経路${response.publicJourneyPresentation.journeys.length}件`] : []),
    ...(response.publicAccommodationPresentation ? [`宿${response.publicAccommodationPresentation.cards.length}件`] : []),
  ];
  const text = visibleAssistantText(response.text);
  if (candidateGroups.length && !response.publicAccommodationPresentation) {
    renderAssistantCopy(item, `${candidateGroups.join("・")}を表示しました。パネルで比較できます。`, false);
    // Keep explanations available without duplicating the comparison in the main reading flow.
    if (text.trim()) {
      const details = document.createElement("details"), summary = document.createElement("summary");
      details.className = "candidate-reply-details"; summary.textContent = "比較の補足";
      details.append(summary, renderAssistantMarkdown(text)); item.append(details);
    }
  } else renderAssistantCopy(item, text, options.animate ?? true);
  if (response.delivery && response.delivery.status !== "full") item.append(renderDeliveryStatus(response.delivery));
  if (response.semanticReceipt) item.append(renderSemanticReceipt(response.semanticReceipt));
  const combined = response.publicJourneyPresentation && response.publicPlanPresentation &&
    canCombineJourneyPlan(response.publicJourneyPresentation, response.publicPlanPresentation);
  const combinedAccommodation = !combined && response.publicAccommodationPresentation && response.publicPlanPresentation &&
    canCombineAccommodationPlan(response.publicAccommodationPresentation, response.publicPlanPresentation);
  if (response.publicJourneyPresentation) item.append(renderPublicJourneyPresentation(response.publicJourneyPresentation,
    combined ? response.publicPlanPresentation : undefined));
  if (response.publicPlanPresentation && !combined && !combinedAccommodation) {
    const plan = renderPublicPlanPresentation(response.publicPlanPresentation);
    if (response.publicJourneyPresentation && response.publicPlanPresentation.candidates.every(candidate => candidate.items.every(value => value.kind === "transport"))) {
      const details = document.createElement("details"), summary = document.createElement("summary");
      details.className = "journey-plan-actions"; summary.textContent = "旅程に追加・変更"; details.append(summary, plan); item.append(details);
    } else item.append(plan);
  }
  if (response.publicAccommodationPresentation) item.append(renderPublicAccommodationPresentation(response.publicAccommodationPresentation,
    combinedAccommodation ? response.publicPlanPresentation : undefined));
  if (response.publicGroundRoutePresentation) item.append(renderPublicGroundRoutePresentation(response.publicGroundRoutePresentation, options.onGroundRoute));
  if (response.publicPlacePresentation) item.append(renderPublicPlacePresentation(response.publicPlacePresentation, options.placeMemoSelection));
  appendConversationFeedback(item);
  item.scrollIntoView({ block: "nearest" });
}

function renderDeliveryStatus(delivery: NonNullable<import("@raiquora/agent/runtime-contract").AgentRuntimeResult["delivery"]>): HTMLElement {
  const status = document.createElement("p");
  status.className = `agent-delivery-status agent-delivery-${delivery.status}`;
  status.textContent = delivery.status === "degraded"
    ? "一部の処理を完了できなかったため、確認済み情報だけを表示しています。"
    : "確認できた範囲の回答です。";
  status.setAttribute("role", "status");
  return status;
}

const semanticTargetLabels: Record<PublicSemanticReceipt["changes"][number]["target"], string> = {
  goal: "旅の目的", origin: "出発地", destination: "行き先", start_date: "開始日", end_date: "終了日", duration: "日数",
  party_size: "人数", budget: "予算", experience: "興味・過ごし方", pace: "ペース", accommodation: "宿泊", transport: "移動",
  fixed_schedule: "固定予定", candidate_selection: "候補",
};

/** Stable public receipt presentation shared by live turns and restored history. */
function renderSemanticReceipt(receipt: PublicSemanticReceipt): HTMLElement {
  const status = document.createElement("p");
  status.className = `semantic-receipt semantic-receipt-${receipt.outcome}`;
  status.textContent = semanticReceiptLabel(receipt);
  status.setAttribute("role", "status");
  return status;
}

export function semanticReceiptLabel(receipt: PublicSemanticReceipt): string {
  const accepted = [...new Set(receipt.changes.filter(change => change.status === "accepted" && change.frame === "actual")
    .map(change => semanticTargetLabels[change.target]))];
  const prefix = receipt.outcome === "accepted" ? "今回の希望に反映" : receipt.outcome === "partial" ? "一部を今回の希望に反映" : "条件変更なし";
  return accepted.length ? `${prefix}: ${accepted.join("・")}` : prefix;
}

function renderAssistantCopy(item: HTMLElement, text: string, animate: boolean): void {
  const copy = document.createElement("div");
  copy.className = "ai-guide-message-copy";
  copy.append(renderAssistantMarkdown(text));
  item.replaceChildren(copy);
  if (animate) typewriteText(copy);
}

function appendConversationFeedback(item: HTMLLIElement): void {
  const feedback = document.createElement("span");
  feedback.className = "conversation-feedback";
  for (const [rating, label] of [["good", "よい回答"], ["bad", "改善が必要"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.conversationFeedback = rating;
    button.ariaLabel = label;
    button.innerHTML = iconMarkup(rating === "good" ? "thumbUp" : "thumbDown");
    feedback.append(button);
  }
  item.append(feedback);
}

function showBadFeedbackComment(
  item: HTMLElement,
  submit: (comment?: string, status?: HTMLElement) => void,
): void {
  const existing = item.querySelector<HTMLFormElement>(".conversation-feedback-comment");
  if (existing) {
    existing.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return;
  }
  const form = document.createElement("form");
  form.className = "conversation-feedback-comment";
  const label = document.createElement("label");
  label.textContent = "改善点があれば教えてください";
  const textarea = document.createElement("textarea");
  textarea.maxLength = 1000;
  textarea.rows = 2;
  textarea.placeholder = "任意入力";
  label.append(textarea);
  const actions = document.createElement("span");
  actions.className = "conversation-feedback-comment-actions";
  const sendWithComment = feedbackAction("コメントを添えて送信", "submit");
  const sendWithoutComment = feedbackAction("コメントなしで送信", "button");
  const cancel = feedbackAction("キャンセル", "button");
  const status = feedbackStatus("");
  actions.append(sendWithComment, sendWithoutComment, cancel);
  form.append(label, actions, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const comment = normalizedFeedbackComment(textarea.value);
    if (comment === undefined) {
      status.textContent = "コメントを入力するか コメントなしで送信してください";
      textarea.focus();
      return;
    }
    submit(comment, status);
  });
  sendWithoutComment.addEventListener("click", () => submit(undefined, status));
  cancel.addEventListener("click", () => {
    form.remove();
    item.querySelector<HTMLButtonElement>('[data-conversation-feedback="bad"]')
      ?.focus();
  });
  item.append(form);
  textarea.focus();
}

export function normalizedFeedbackComment(value: string): string | undefined {
  return value.trim() || undefined;
}

function feedbackAction(
  label: string,
  type: "button" | "submit",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = type;
  button.textContent = label;
  return button;
}

function feedbackStatus(text: string): HTMLSpanElement {
  const status = document.createElement("span");
  status.className = "conversation-feedback-status";
  status.setAttribute("role", "status");
  status.textContent = text;
  return status;
}

function setFeedbackControlsDisabled(item: HTMLElement, disabled: boolean): void {
  for (const control of item.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>(
    ".conversation-feedback button, .conversation-feedback-comment button, .conversation-feedback-comment textarea",
  )) {
    control.disabled = disabled;
  }
}

export function journeyDelayLabel(leg: JourneyRouteResult["legs"][number]): string | undefined {
  const delay = Math.round(leg.delayMinutes ?? 0);
  if (delay <= 0) return undefined;
  return leg.delayStatus === "estimated"
    ? `遅延見込み +${delay}分`
    : `遅延 +${delay}分`;
}
