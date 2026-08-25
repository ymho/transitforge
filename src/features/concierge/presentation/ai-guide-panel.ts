import type { JourneyRouteResult } from "../../../domain/direct-route-search";
import { formatRouteClockTime } from "../../../domain/route-time-format";
import {
  loadUserProfile,
  type UserProfile,
} from "../../../domain/travel-profile";
import type {
  ConversationGuidance,
  ConversationSubmission,
} from "../../../domain/conversation-guidance";
import {
  appendConversationHistory,
  loadConversationHistory,
} from "../../../domain/conversation-history";
import { recommendedTravelDestinations } from "../../../domain/travel-destination";
import {
  defaultJourneySearchPreferences,
  isJourneyRankingPreference,
  isTransferPace,
  type JourneyRankingPreference,
  type JourneySearchPreferences,
  type TransferPace,
} from "../../../domain/journey-search-preferences";
import type {
  ViewerAgentJourneyPlan,
  ViewerAgentTravelPlan,
  ViewerAgentResponse,
} from "../../../domain/viewer-agent-response";
import type { TripContext } from "../../../domain/travel-profile";
import { hideSheet, showSheet } from "../../../presentation/sheet-transition";
import { renderAssistantMarkdown, visibleAssistantText } from "./assistant-markdown";
import {
  loadJourneySearchPreferences,
  saveJourneySearchPreferences,
} from "./journey-preferences-storage";

export { visibleAssistantText } from "./assistant-markdown";
export { loadJourneySearchPreferences } from "./journey-preferences-storage";

export interface AgentResponseMetadata {
  requestId?: string;
}

export interface ConversationFeedback {
  rating: "good" | "bad";
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  requestIds: string[];
}

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
  contextChoices: HTMLElement;
  settingsToggle: HTMLButtonElement;
  settingsPanel: HTMLElement;
  transferPace: HTMLSelectElement;
  rankingPreference: HTMLSelectElement;
  storage: Storage;
  submitFeedback: (feedback: ConversationFeedback) => Promise<void>;
  onFirstPrompt?: (prompt: string) => void;
  onTravelPlan?: (plan: ViewerAgentTravelPlan) => void;
  onTripPlanUpdate?: (proposal: import("../../../domain/trip-plan").TripPlanUpdateProposal) => void;
}

export type AiGuidePromptHandler = (
  prompt: string,
  preferences: JourneySearchPreferences,
  conversation?: ConversationSubmission,
  onResponseMetadata?: (metadata: AgentResponseMetadata) => void,
) => Promise<ViewerAgentResponse>;

export interface AiGuidePanelController {
  openLandmarkJourney(name: string, type?: string): void;
  open(): void;
  ask(prompt: string): void;
}

let journeyPlanSequence = 0;

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
    contextChoices,
    settingsToggle,
    settingsPanel,
    transferPace,
    rankingPreference,
    storage,
    submitFeedback,
  } = elements;
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
    if (open) showConciergeIntro();
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
    if (!target || target.disabled) return;
    const rating = target.dataset.conversationFeedback;
    if (rating !== "good" && rating !== "bad") return;
    target.disabled = true;
    const conversation = Array.from(messages.querySelectorAll<HTMLElement>(".ai-guide-message"))
      .flatMap((message) => message.dataset.feedbackText === undefined ? [] : [{
        role: message.classList.contains("ai-guide-message-user") ? "user" as const : "assistant" as const,
        text: message.dataset.feedbackText,
      }])
      .filter((message) => message.text.length > 0);
    void submitFeedback({ rating, conversation, requestIds: [...agentRequestIds] })
      .then(() => { target.dataset.feedbackStored = "true"; })
      .catch(() => { target.disabled = false; });
  });

  const agentRequestIds = new Set<string>();
  let activeConversation: ConversationGuidance | undefined;
  let activeTripContext: TripContext | undefined;
  const restoredHistory = loadConversationHistory(storage, elements.conversationSessionId);
  let hasConversationHistory = restoredHistory.length > 0;
  for (const entry of restoredHistory) {
    if (entry.role === "user") {
      appendMessage(messages, "user", entry.text);
    } else {
      if (entry.requestId) agentRequestIds.add(entry.requestId);
      const restored = appendPendingMessage(messages);
      resolveAssistantMessage(restored, entry.response, undefined, elements.onTripPlanUpdate);
      if (typeof entry.response !== "string" && "travelPlan" in entry.response) {
        activeTripContext = tripContextFromTravelPlan(entry.response.travelPlan);
      }
    }
  }
  const setContextChoices = (guidance?: ConversationGuidance) => {
    contextChoices.replaceChildren();
    const choices = guidance?.quickReplies ?? [];
    contextChoices.hidden = choices.length === 0;
    for (const reply of choices) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.textContent = reply.label;
      choice.addEventListener("click", () => submitPrompt(reply.value));
      contextChoices.append(choice);
    }
    if (choices.length > 0) messages.append(contextChoices);
  };

  const sendPrompt = (prompt: string, conversation?: ConversationSubmission) => {
    if (!prompt || submit.disabled) {
      return;
    }

    if (!hasConversationHistory) {
      elements.onFirstPrompt?.(prompt);
      hasConversationHistory = true;
    }
    appendMessage(messages, "user", prompt);
    appendConversationHistory(
      storage,
      elements.conversationSessionId,
      { role: "user", text: prompt },
    );
    input.value = "";
    input.disabled = true;
    submit.disabled = true;
    submit.ariaLabel = "送信中";
    submit.dataset.submitting = "true";
    const pendingMessage = appendPendingMessage(messages);

    let requestId: string | undefined;
    void handlePrompt(prompt, preferences(), conversation, (metadata) => {
      requestId = metadata.requestId;
      if (requestId) agentRequestIds.add(requestId);
    })
      .then((response) => {
        const guidance = typeof response === "string" || !("conversation" in response)
          ? undefined
          : response.conversation;
        activeConversation = guidance;
        activeTripContext = typeof response !== "string" && "travelPlan" in response
          ? tripContextFromTravelPlan(response.travelPlan)
          : guidance?.tripContext;
        setContextChoices(guidance);
        if (guidance) {
          input.placeholder = inputPlaceholderForConversation(guidance);
        } else {
          input.placeholder = "列車、行き先、旅の相談を入力";
        }
        resolveAssistantMessage(pendingMessage, response, elements.onTravelPlan, elements.onTripPlanUpdate);
        appendConversationHistory(
          storage,
          elements.conversationSessionId,
          {
            role: "assistant",
            response,
            ...(requestId ? { requestId } : {}),
          },
        );
      })
      .catch(() => {
        const errorResponse = "案内を開始できませんでした。時間をおいてもう一度お試しください。";
        resolveAssistantMessage(pendingMessage, errorResponse);
        appendConversationHistory(storage, elements.conversationSessionId, {
          role: "assistant",
          response: errorResponse,
          ...(requestId ? { requestId } : {}),
        });
      })
      .finally(() => {
        input.disabled = false;
        submit.disabled = false;
        submit.ariaLabel = "送信";
        delete submit.dataset.submitting;
        input.focus();
      });
  };

  const submitPrompt = (prompt: string) => {
    if (!prompt || submit.disabled) return;
    const guidance = activeConversation ?? (activeTripContext === undefined ? undefined : {
      question: "現在の旅行条件を変更します",
      expectedInput: "free-text" as const,
      quickReplies: [],
      tripContext: activeTripContext,
    });
    const conversation = guidance === undefined ? undefined : { answer: prompt, guidance };
    activeConversation = undefined;
    setContextChoices();
    sendPrompt(prompt, conversation);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPrompt(input.value.trim());
  });

  let hasShownConciergeIntro = false;
  const showConciergeIntro = () => {
    if (hasShownConciergeIntro || messages.querySelector(".ai-guide-message") !== null) return;
    appendConciergeIntroCards(
      messages,
      loadUserProfile(storage),
      (destination) => controller.openLandmarkJourney(destination),
    );
    hasShownConciergeIntro = true;
  };

  const controller: AiGuidePanelController = {
    openLandmarkJourney(name) {
      setOpen(true);
      showConciergeIntro();
      sendPrompt(`${name}へ旅行したい`);
    },
    open() {
      setOpen(true);
      showConciergeIntro();
    },
    ask(prompt) { setOpen(true); sendPrompt(prompt); },
  };
  return controller;
}

function tripContextFromTravelPlan(plan: ViewerAgentTravelPlan): TripContext {
  return {
    destinationWish: plan.destination,
    startDate: plan.checkInDate,
    endDate: plan.checkOutDate,
  };
}

function inputPlaceholderForConversation(guidance: ConversationGuidance): string {
  switch (guidance.expectedInput) {
    case "departure-date": return "例: 来週の火曜日、9月3日";
    case "stay-length": return "例: 1泊、2泊、日帰り";
    case "traveler-count": return "例: 大人2人、子ども1人";
    default: return "自由に入力できます";
  }
}

function appendConciergeIntroCards(
  messages: HTMLOListElement,
  profile?: UserProfile,
  selectDestination?: (destination: string) => void,
): void {
  const item = document.createElement("li");
  // おすすめは会話履歴ではなく入力前の補助コンテンツとして扱う。
  item.className = "concierge-intro";
  item.setAttribute("aria-label", "おすすめの行き先");
  const title = document.createElement("p");
  title.textContent = "あなたが興味がありそうなスポット";
  const cards = document.createElement("div");
  cards.className = "concierge-intro-cards";
  for (const destination of recommendedTravelDestinations(profile)) {
    const card = document.createElement("button");
    card.type = "button";
    const iconElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconElement.classList.add("concierge-intro-card-icon");
    iconElement.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-ai-sparkles");
    iconElement.append(use);
    const copy = document.createElement("span");
    copy.className = "concierge-intro-card-copy";
    const heading = document.createElement("strong");
    heading.textContent = destination.name;
    const caption = document.createElement("small");
    caption.textContent = `${destination.interests.slice(0, 2).map(travelPreferenceLabel).join("・")}を楽しむ旅`;
    copy.append(heading, caption);
    card.append(iconElement, copy);
    card.addEventListener("click", () => {
      for (const candidate of cards.querySelectorAll<HTMLButtonElement>("button")) {
        candidate.disabled = true;
      }
      item.classList.add("is-resolved");
      selectDestination?.(destination.name);
    });
    cards.append(card);
  }
  item.append(title, cards);
  messages.append(item);
}

function travelPreferenceLabel(value: string): string {
  return {
    sea: "海", mountain: "山", nature: "自然", onsen: "温泉", food: "食",
    railway: "鉄道", history: "歴史", cityWalk: "街歩き", animals: "動物",
    art: "アート", themePark: "テーマパーク", shopping: "買い物",
  }[value] ?? "旅";
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
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `ai-guide-message ai-guide-message-${role}`;
  item.textContent = role === "assistant" ? visibleAssistantText(text) : text;
  item.dataset.feedbackText = item.textContent;
  if (role === "assistant") appendConversationFeedback(item);
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

function appendPendingMessage(messages: HTMLOListElement): HTMLLIElement {
  const item = document.createElement("li");
  item.className =
    "ai-guide-message ai-guide-message-assistant ai-guide-message-pending";
  item.setAttribute("aria-label", "AIが回答を準備しています");

  const label = document.createElement("span");
  label.textContent = "考え中";
  const dots = document.createElement("span");
  dots.className = "ai-guide-thinking-dots";
  dots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    dots.append(document.createElement("i"));
  }

  item.append(label, dots);
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

function resolveAssistantMessage(
  item: HTMLLIElement,
  response: ViewerAgentResponse,
  onTravelPlan?: (plan: ViewerAgentTravelPlan) => void,
  onTripPlanUpdate?: (proposal: import("../../../domain/trip-plan").TripPlanUpdateProposal) => void,
): void {
  item.classList.remove("ai-guide-message-pending");
  item.removeAttribute("aria-label");
  if (typeof response === "string") {
    item.replaceChildren(renderAssistantMarkdown(visibleAssistantText(response)));
  } else if ("conversation" in response) {
    item.replaceChildren(renderAssistantMarkdown(visibleAssistantText(response.text)));
  } else if ("tripPlanUpdate" in response) {
    item.replaceChildren(renderAssistantMarkdown(visibleAssistantText(response.text)));
    const changes = document.createElement("ul");
    changes.className = "trip-plan-update-changes";
    for (const patch of response.tripPlanUpdate.patches) {
      const change = document.createElement("li");
      change.textContent = tripPlanPatchLabel(patch);
      changes.append(change);
    }
    item.append(changes);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "trip-plan-update-apply";
    apply.textContent = "旅程に反映";
    apply.addEventListener("click", () => {
      onTripPlanUpdate?.(response.tripPlanUpdate);
      apply.disabled = true;
      apply.textContent = "旅程に反映済み";
    });
    item.append(apply);
  } else if ("travelPlan" in response) {
    item.classList.add("ai-guide-message-journey");
    item.replaceChildren();
    const text = document.createElement("p");
    text.className = "journey-plan-intro";
    text.textContent = visibleAssistantText(response.text);
    item.append(text);
    onTravelPlan?.(response.travelPlan);
  } else {
    item.classList.add("ai-guide-message-journey");
    item.replaceChildren();
    const text = document.createElement("p");
    text.className = "journey-plan-intro";
    text.textContent = visibleAssistantText(response.text);
    item.append(text, renderJourneyPlan(response.journeyPlan));
  }
  item.dataset.feedbackText = typeof response === "string"
    ? visibleAssistantText(response)
    : visibleAssistantText(response.text);
  appendConversationFeedback(item);
  item.scrollIntoView({ block: "nearest" });
}

function tripPlanPatchLabel(patch: import("../../../domain/trip-plan").TripPlanPatch): string {
  if (patch.type === "metadata") {
    return patch.conditions ? "人数と考慮事項を変更" : "旅程の基本情報を変更";
  }
  if (patch.type === "add") return patch.item.type === "sightseeing" ? `${patch.item.place.name}を観光へ追加` : `${patch.item.type === "movement" ? "移動" : "滞在"}を追加`;
  if (patch.type === "replace") return `${patch.item.type === "movement" ? "移動経路" : patch.item.type === "stay" ? "滞在" : "観光"}を更新`;
  if (patch.type === "remove") return "旅程から項目を削除";
  return "旅程の順番を変更";
}

function appendConversationFeedback(item: HTMLLIElement): void {
  const feedback = document.createElement("span");
  feedback.className = "conversation-feedback";
  for (const [rating, label] of [["good", "よい回答"], ["bad", "改善が必要"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.conversationFeedback = rating;
    button.ariaLabel = label;
    button.textContent = rating === "good" ? "👍" : "👎";
    feedback.append(button);
  }
  item.append(feedback);
}

function renderJourneyPlan(
  plan: ViewerAgentJourneyPlan,
): HTMLElement {
  const planSequence = ++journeyPlanSequence;
  const container = document.createElement("section");
  container.className = "journey-plan";
  const tabs = document.createElement("div");
  tabs.className = "journey-plan-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "経路候補");
  const panels = document.createElement("div");
  panels.className = "journey-plan-panels";
  const hasMultipleJourneys = plan.journeys.length > 1;
  const excludedLabels = [...new Set([
    ...(plan.excludedServiceTypes ?? []),
    ...(plan.excludedTrainNames ?? []),
    ...(plan.excludedTrainNumbers ?? []),
  ])];
  const requiredLabels = [...new Set([
    ...(plan.requiredServiceTypes ?? []),
    ...(plan.requiredTrainNames ?? []),
    ...(plan.requiredTrainNumbers ?? []),
  ])];
  if (plan.transferPace && plan.rankingPreference) {
    const conditions = document.createElement("p");
    conditions.className = "journey-plan-conditions";
    conditions.textContent = [
      `乗換: ${transferPaceLabel(plan.transferPace)}`,
      `優先: ${rankingPreferenceLabel(plan.rankingPreference)}`,
      `最大乗換: ${plan.maxTransfers ?? 3}回`,
      ...(excludedLabels.length
        ? [`除外: ${excludedLabels.join("・")}`]
        : []),
      ...(requiredLabels.length
        ? [`利用: ${requiredLabels.join("・")}`]
        : []),
      ...(plan.allowedServiceTypes?.length
        ? [`限定: ${plan.allowedServiceTypes.join("・")}`]
        : []),
    ].join("　");
    container.append(conditions);
  }

  plan.journeys.forEach((journey, index) => {
    const tab = document.createElement("button");
    const panel = document.createElement("article");
    const tabId = `journey-tab-${planSequence}-${index}`;
    const panelId = `journey-panel-${planSequence}-${index}`;
    if (hasMultipleJourneys) {
      tab.type = "button";
      tab.id = tabId;
      tab.className = "journey-plan-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panelId);
      tab.setAttribute("aria-selected", String(index === 0));
      tab.textContent = `候補${index + 1}`;
    }
    panel.id = panelId;
    panel.className = "journey-plan-panel";
    if (hasMultipleJourneys) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      panel.tabIndex = 0;
    }
    panel.hidden = index !== 0;
    panel.replaceChildren(
      renderJourneySummary(journey),
      renderJourneyTimeline(journey),
    );
    tab.addEventListener("click", () => {
      for (const candidate of tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
        candidate.setAttribute("aria-selected", String(candidate === tab));
      }
      for (const candidate of panels.querySelectorAll<HTMLElement>("[role=tabpanel]")) {
        candidate.hidden = candidate !== panel;
      }
      panel.focus({ preventScroll: true });
    });
    if (hasMultipleJourneys) tabs.append(tab);
    panels.append(panel);
  });
  if (hasMultipleJourneys) container.append(tabs);
  container.append(panels);
  return container;
}

function renderJourneySummary(journey: JourneyRouteResult): HTMLElement {
  const summary = document.createElement("div");
  summary.className = "journey-plan-summary";
  const time = document.createElement("strong");
  time.textContent = `${formatRouteClockTime(journey.departureTimeMinutes)} → ${formatRouteClockTime(journey.arrivalTimeMinutes)}`;
  const detail = document.createElement("span");
  const duration = Math.max(0, journey.arrivalTimeMinutes - journey.departureTimeMinutes);
  detail.textContent = `${formatDuration(duration)}・${journey.transferCount === 0 ? "乗換なし" : `乗換${journey.transferCount}回`}`;
  summary.append(time, detail);
  return summary;
}

function renderJourneyTimeline(
  journey: JourneyRouteResult,
): HTMLElement {
  const timeline = document.createElement("div");
  timeline.className = "journey-timeline";
  journey.legs.forEach((leg, index) => {
    const segment = document.createElement("section");
    segment.className = "journey-leg";
    segment.style.setProperty("--journey-line-color", safeLineColor(leg.lineColor));
    const summary = document.createElement("div");
    summary.className = "journey-leg-summary";
    const trainLabel = [
      leg.serviceType,
      leg.trainName,
      destinationLabel(leg.serviceDestination ?? leg.destinationStation),
    ].filter(Boolean).join(" ");
    summary.append(
      stationRow(formatRouteClockTime(leg.departureTimeMinutes), leg.originStation),
      segmentLine(trainLabel, leg.lineName, journeyDelayLabel(leg), leg.delayBasis),
    );
    summary.append(
      stationRow(formatRouteClockTime(leg.arrivalTimeMinutes), leg.destinationStation),
    );
    segment.append(summary);
    timeline.append(segment);
    const nextLeg = journey.legs[index + 1];
    if (nextLeg) {
      const transfer = document.createElement("p");
      transfer.className = "journey-transfer";
      transfer.textContent = `${leg.destinationStation}で乗換・${Math.round(nextLeg.departureTimeMinutes - leg.arrivalTimeMinutes)}分待ち`;
      timeline.append(transfer);
    }
  });
  return timeline;
}

function stationRow(time: string, station: string): HTMLElement {
  const row = document.createElement("span");
  row.className = "journey-station";
  const timeElement = document.createElement("time");
  timeElement.textContent = time;
  const name = document.createElement("strong");
  name.textContent = station;
  row.append(timeElement, name);
  return row;
}

function segmentLine(
  label: string,
  lineName?: string,
  delayLabel?: string,
  delayBasis?: string,
): HTMLElement {
  const row = document.createElement("span");
  row.className = "journey-segment";
  const line = document.createElement("i");
  line.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  const primary = document.createElement("strong");
  primary.textContent = label;
  text.append(primary);
  if (lineName) {
    const secondary = document.createElement("small");
    secondary.textContent = lineName;
    text.append(secondary);
  }
  if (delayLabel) {
    const delay = document.createElement("small");
    delay.className = "journey-delay-badge";
    delay.textContent = delayLabel;
    if (delayBasis) {
      delay.title = `${delayBasis}を走る近隣列車から推定`;
    }
    text.append(delay);
  }
  row.append(line, text);
  return row;
}

export function journeyDelayLabel(leg: JourneyRouteResult["legs"][number]): string | undefined {
  const delay = Math.round(leg.delayMinutes ?? 0);
  if (delay <= 0) return undefined;
  return leg.delayStatus === "estimated"
    ? `遅延見込み +${delay}分`
    : `遅延 +${delay}分`;
}

function destinationLabel(value: string): string {
  const destination = value.trim().replace(/駅$/u, "");
  return destination === "" || /行き$/u.test(destination)
    ? destination
    : `${destination}行き`;
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  return hours > 0 ? `${hours}時間${rounded % 60}分` : `${rounded}分`;
}

function safeLineColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : "#8b96a1";
}

function transferPaceLabel(value: TransferPace): string {
  return { hurried: "急ぐ", standard: "普通", relaxed: "ゆっくり" }[value];
}

function rankingPreferenceLabel(value: JourneyRankingPreference): string {
  return {
    balanced: "バランス",
    "earliest-arrival": "早く着く",
    "latest-departure": "遅く出る",
    "fewest-transfers": "乗換少なめ",
  }[value];
}
