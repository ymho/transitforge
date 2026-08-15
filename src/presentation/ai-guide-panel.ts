import type { JourneyRouteResult } from "../domain/direct-route-search";
import {
  defaultJourneySearchPreferences,
  isJourneyRankingPreference,
  isTransferPace,
  type JourneyRankingPreference,
  type JourneySearchPreferences,
  type TransferPace,
} from "../domain/journey-search-preferences";
import type {
  ViewerAgentJourneyPlan,
  ViewerAgentResponse,
} from "../domain/viewer-agent-response";
import { hideSheet, showSheet } from "./sheet-transition";

export interface AiGuidePanelElements {
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
}

export type AiGuidePromptHandler = (
  prompt: string,
  preferences: JourneySearchPreferences,
) => Promise<ViewerAgentResponse>;

let journeyPlanSequence = 0;
const journeyPreferencesStorageKey = "transitforge.journey-search-preferences.v1";

export function configureAiGuidePanel(
  elements: AiGuidePanelElements,
  handlePrompt: AiGuidePromptHandler,
): void {
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
  } = elements;
  const savedPreferences = loadJourneySearchPreferences();
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
  const savePreferences = () => storeJourneySearchPreferences(preferences());
  transferPace.addEventListener("change", savePreferences);
  rankingPreference.addEventListener("change", savePreferences);
  settingsToggle.addEventListener("click", () => {
    const open = settingsPanel.hidden;
    settingsPanel.hidden = !open;
    settingsToggle.ariaExpanded = String(open);
  });

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

  toggle.addEventListener("click", () => setOpen(toggle.ariaExpanded !== "true"));
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

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || submit.disabled) {
      return;
    }

    appendMessage(messages, "user", prompt);
    input.value = "";
    input.disabled = true;
    submit.disabled = true;
    submit.ariaLabel = "送信中";
    submit.dataset.submitting = "true";
    const pendingMessage = appendPendingMessage(messages);

    void handlePrompt(prompt, preferences())
      .then((response) => {
        resolveAssistantMessage(pendingMessage, response);
      })
      .catch(() => {
        resolveAssistantMessage(
          pendingMessage,
          "案内を開始できませんでした。時間をおいてもう一度お試しください。",
        );
      })
      .finally(() => {
        input.disabled = false;
        submit.disabled = false;
        submit.ariaLabel = "送信";
        delete submit.dataset.submitting;
        input.focus();
      });
  });
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
): void {
  const item = document.createElement("li");
  item.className = `ai-guide-message ai-guide-message-${role}`;
  item.textContent = role === "assistant" ? visibleAssistantText(text) : text;
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
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
): void {
  item.classList.remove("ai-guide-message-pending");
  item.removeAttribute("aria-label");
  if (typeof response === "string") {
    item.textContent = visibleAssistantText(response);
  } else {
    item.classList.add("ai-guide-message-journey");
    item.replaceChildren();
    const text = document.createElement("p");
    text.className = "journey-plan-intro";
    text.textContent = visibleAssistantText(response.text);
    item.append(text, renderJourneyPlan(response.journeyPlan));
  }
  item.scrollIntoView({ block: "nearest" });
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
  if (plan.transferPace && plan.rankingPreference) {
    const conditions = document.createElement("p");
    conditions.className = "journey-plan-conditions";
    conditions.textContent = `乗換: ${transferPaceLabel(plan.transferPace)}　優先: ${rankingPreferenceLabel(plan.rankingPreference)}　最大乗換: ${plan.maxTransfers ?? 3}回`;
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
  time.textContent = `${formatClock(journey.departureTimeMinutes)} → ${formatClock(journey.arrivalTimeMinutes)}`;
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
      stationRow(formatClock(leg.departureTimeMinutes), leg.originStation),
      segmentLine(trainLabel, leg.lineName, journeyDelayLabel(leg), leg.delayBasis),
    );
    summary.append(
      stationRow(formatClock(leg.arrivalTimeMinutes), leg.destinationStation),
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

function formatClock(minutes: number): string {
  const rounded = Math.round(minutes);
  const clock = ((rounded % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  return hours > 0 ? `${hours}時間${rounded % 60}分` : `${rounded}分`;
}

function safeLineColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : "#8b96a1";
}

export function loadJourneySearchPreferences(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): JourneySearchPreferences {
  try {
    const value: unknown = JSON.parse(storage.getItem(journeyPreferencesStorageKey) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "transferPace" in value &&
      "rankingPreference" in value &&
      isTransferPace(value.transferPace) &&
      isJourneyRankingPreference(value.rankingPreference)
    ) {
      return {
        transferPace: value.transferPace,
        rankingPreference: value.rankingPreference,
        maxTransfers: 3,
      };
    }
  } catch {
    // 読み込めない保存値は既定値へ戻す
  }
  return { ...defaultJourneySearchPreferences };
}

function storeJourneySearchPreferences(
  preferences: JourneySearchPreferences,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(journeyPreferencesStorageKey, JSON.stringify(preferences));
  } catch {
    // 保存できなくても現在の検索設定は使える
  }
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

export function visibleAssistantText(text: string): string {
  const responseBlocks = Array.from(
    text.matchAll(/<response\b[^>]*>([\s\S]*?)<\/response>/gi),
    (match) => withoutThinking(match[1] ?? "").trim(),
  ).filter(Boolean);
  if (responseBlocks.length > 0) {
    return responseBlocks.join("\n\n");
  }

  const visibleSource = withoutThinking(text);
  const unclosedResponse = visibleSource.match(
    /<response\b[^>]*>([\s\S]*)$/i,
  )?.[1];
  const visibleText = (unclosedResponse ?? visibleSource)
    .replace(/<\/?response\b[^>]*>/gi, "")
    .trim();
  return visibleText || "案内を完了しました。";
}

function withoutThinking(text: string): string {
  return text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/?thinking\b[^>]*>/gi, "");
}
