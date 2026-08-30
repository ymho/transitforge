import type { JourneyRouteLeg } from "@raiquora/journey/direct-route-search";
import {
  applyTripPlanPatches,
  selectTripPlanAccommodation,
  validateTripPlanPatches,
  type MovementMode,
  type TripPlan,
  type TripPlanItem,
  type TripPlanPatch,
} from "@raiquora/trip/trip-plan";
import {
  loadTripPlan,
  migrateLegacyTripPlan,
  saveTripPlan,
} from "../../usecases/trip-plan/trip-plan-repository";
import type { ViewerAgentAccommodation } from "../../domain/viewer-agent-response";

export interface TripPlanPanelController {
  switchSession(conversationSessionId: string): void;
  show(plan: TripPlan): void;
  showPreview(plan: TripPlan): void;
  apply(patches: TripPlanPatch[]): void;
  selectAccommodation(accommodation: ViewerAgentAccommodation): void;
  open(): void;
}

export function configureTripPlanPanel(
  panel: HTMLElement,
  content: HTMLElement,
  close: HTMLButtonElement,
  toggle: HTMLButtonElement,
  initialConversationSessionId: string,
  beginChat: (prompt: string) => void,
  storage: Storage,
  showAccommodationCandidates?: (
    accommodations: readonly ViewerAgentAccommodation[],
    stay: { destination: string; checkInDate: string; checkOutDate: string },
  ) => void,
): TripPlanPanelController {
  let conversationSessionId = initialConversationSessionId;
  let plan = migrateLegacyTripPlan(storage, conversationSessionId) ??
    loadTripPlan(storage, conversationSessionId);
  let persistChanges = true;
  const collapsedItems = new Set<string>();

  const open = () => {
    render();
    panel.hidden = false;
  };
  const startChat = (prompt: string) => {
    panel.hidden = true;
    beginChat(prompt);
  };
  const render = () => {
    content.replaceChildren();
    toggle.hidden = plan === undefined;
    if (!plan) {
      content.append(paragraph("旅行の相談をすると、ここに旅程が作られます。", "trip-plan-empty"));
      return;
    }
    const currentPlan = plan;

    content.append(renderPlanHeading(currentPlan, startChat));
    content.append(renderPlanConditions(currentPlan, startChat));
    const cards = document.createElement("div");
    cards.className = "trip-plan-cards";
    currentPlan.items.forEach((item, index) => {
      cards.append(renderTripPlanCard(
        item,
        currentPlan,
        startChat,
        collapsedItems,
        showAccommodationCandidates,
      ));
      const next = currentPlan.items[index + 1];
      if (next) cards.append(renderInsertionControl(item, next, startChat));
    });
    content.append(cards);

    const add = button("＋ 観光を追加", "trip-plan-add");
    add.addEventListener("click", () =>
      startChat(`${currentPlan.destination}で立ち寄る観光地を探したい`));
    content.append(add);
  };

  const controller: TripPlanPanelController = {
    switchSession(nextConversationSessionId) {
      conversationSessionId = nextConversationSessionId;
      plan = migrateLegacyTripPlan(storage, conversationSessionId) ??
        loadTripPlan(storage, conversationSessionId);
      persistChanges = true;
      collapsedItems.clear();
      render();
    },
    show(next) {
      plan = next;
      persistChanges = true;
      saveTripPlan(storage, conversationSessionId, plan);
      open();
    },
    showPreview(next) {
      plan = next;
      persistChanges = false;
      open();
    },
    apply(patches) {
      if (!plan) return;
      if (!validateTripPlanPatches(plan, patches).valid) return;
      plan = applyTripPlanPatches(plan, patches);
      if (persistChanges) saveTripPlan(storage, conversationSessionId, plan);
      open();
    },
    selectAccommodation(accommodation) {
      if (!plan) return;
      plan = selectTripPlanAccommodation(plan, accommodation);
      if (persistChanges) saveTripPlan(storage, conversationSessionId, plan);
      render();
    },
    open,
  };

  close.addEventListener("click", () => { panel.hidden = true; });
  toggle.addEventListener("click", open);
  render();
  return controller;
}

function renderPlanConditions(
  plan: TripPlan,
  beginChat: (prompt: string) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "trip-plan-conditions";
  const header = document.createElement("header");
  const copy = document.createElement("span");
  const title = document.createElement("h3");
  title.textContent = "この旅で考慮したこと";
  const description = document.createElement("p");
  description.textContent = "人数や過ごし方など、プランの前提です";
  copy.append(title, description);
  const edit = button("条件を相談", "trip-plan-conditions-edit");
  edit.addEventListener("click", () => beginChat(
    `${plan.destination}旅行の人数やペース、避けたいことを確認して変更したい`,
  ));
  header.append(copy, edit);
  section.append(header);

  const values = document.createElement("ul");
  values.className = "trip-plan-condition-list";
  const conditions = plan.conditions;
  if (conditions) {
    if (conditions.adults > 0) values.append(conditionChip(`大人${conditions.adults}人`));
    if (conditions.children > 0) values.append(conditionChip(`子ども${conditions.children}人`));
  }
  const stay = plan.items.find((item) => item.type === "stay");
  if (stay?.type === "stay") {
    const stayNights = nights(stay.checkInDate, stay.checkOutDate);
    values.append(conditionChip(`${stayNights}泊${stayNights + 1}日`));
  }
  for (const consideration of conditions?.considerations ?? []) {
    values.append(conditionChip(consideration));
  }
  if (values.childElementCount === 0) {
    values.append(conditionChip("人数や考慮事項はまだ未設定", true));
  }
  section.append(values);
  return section;
}

function conditionChip(text: string, muted = false): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = text;
  item.classList.toggle("is-muted", muted);
  return item;
}

function renderPlanHeading(
  plan: TripPlan,
  beginChat: (prompt: string) => void,
): HTMLElement {
  const heading = document.createElement("section");
  heading.className = "trip-plan-heading";
  const row = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = plan.title;
  const actions = document.createElement("span");
  actions.className = "trip-plan-heading-actions";
  const regenerate = iconButton("#icon-refresh", "旅の内容からタイトルを再生成");
  regenerate.addEventListener("click", () =>
    beginChat(tripPlanTitleRegenerationPrompt(plan)));
  const share = iconButton("#icon-share", "旅程を共有");
  const status = document.createElement("small");
  status.className = "trip-plan-share-status";
  status.setAttribute("aria-live", "polite");
  share.addEventListener("click", () => {
    void shareTripPlan(plan).then((message) => {
      status.textContent = message;
      window.setTimeout(() => {
        if (status.textContent === message) status.textContent = "";
      }, 2_500);
    });
  });
  actions.append(regenerate, share);
  row.append(title, actions);
  heading.append(row, status);
  return heading;
}

function iconButton(iconId: string, label: string): HTMLButtonElement {
  const control = button("", "trip-plan-heading-action");
  control.ariaLabel = label;
  control.title = label;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", iconId);
  icon.append(use);
  control.append(icon);
  return control;
}

async function shareTripPlan(plan: TripPlan): Promise<string> {
  const text = tripPlanShareText(plan);
  if (navigator.share) {
    try {
      await navigator.share({ title: plan.title, text });
      return "共有しました";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "旅程をコピーしました";
  } catch {
    return "共有できませんでした";
  }
}

export function tripPlanShareText(plan: TripPlan): string {
  const lines = [plan.title];
  if (plan.conditions) {
    const travelers = [
      plan.conditions.adults > 0 ? `大人${plan.conditions.adults}人` : "",
      plan.conditions.children > 0 ? `子ども${plan.conditions.children}人` : "",
    ].filter(Boolean).join(" ");
    if (travelers) lines.push(travelers);
    if (plan.conditions.considerations.length > 0) {
      lines.push(`考慮事項: ${plan.conditions.considerations.join("・")}`);
    }
  }
  plan.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${itemSummary(item)}${itemDateLabel(item)}`);
  });
  return lines.join("\n");
}

export function tripPlanTitleRegenerationPrompt(plan: TripPlan): string {
  return [
    "次の旅程にある移動、滞在、観光の内容を見て、現在とは異なる旅のタイトルを1つ再生成して。",
    "行程は変更せず、propose_trip_updateのmetadata.titleとして変更案を出して。",
    tripPlanShareText(plan).slice(0, 1_200),
  ].join("\n");
}

function itemDateLabel(item: TripPlanItem): string {
  if (item.type === "movement") {
    const date = item.mode === "rail" ? item.route.departureDate : item.date;
    return date ? ` ${formatDate(date)}` : "";
  }
  if (item.type === "stay") {
    return ` ${formatDate(item.checkInDate)}から${nights(item.checkInDate, item.checkOutDate)}泊`;
  }
  return item.date ? ` ${formatDate(item.date)}` : "";
}

function renderTripPlanCard(
  item: TripPlanItem,
  plan: TripPlan,
  beginChat: (prompt: string) => void,
  collapsedItems: Set<string>,
  showAccommodationCandidates?: (
    accommodations: readonly ViewerAgentAccommodation[],
    stay: { destination: string; checkInDate: string; checkOutDate: string },
  ) => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = `trip-plan-card trip-plan-card-${item.type}`;
  const body = document.createElement("div");
  body.className = "trip-plan-card-body";
  const collapsed = collapsedItems.has(item.id);
  body.hidden = collapsed;
  card.classList.toggle("is-collapsed", collapsed);
  card.append(renderCardHeader(item, collapsed, () => {
    const shouldCollapse = !body.hidden;
    body.hidden = shouldCollapse;
    card.classList.toggle("is-collapsed", shouldCollapse);
    if (shouldCollapse) collapsedItems.add(item.id);
    else collapsedItems.delete(item.id);
  }));

  if (item.type === "movement") {
    body.append(item.mode === "rail"
      ? renderRailMovement(item.route)
      : renderManualMovement(item.mode, item.origin, item.destination, item.note));
  } else if (item.type === "stay") {
    body.append(renderStay(item, showAccommodationCandidates));
  } else {
    body.append(paragraph(item.place.name, "trip-plan-place"));
  }

  const footer = document.createElement("footer");
  const consult = button("相談する", "trip-plan-consult");
  consult.addEventListener("click", () => beginChat(consultationPrompt(item, plan)));
  footer.append(consult);
  body.append(footer);
  card.append(body);
  return card;
}

function renderCardHeader(
  item: TripPlanItem,
  collapsed: boolean,
  toggle: () => void,
): HTMLElement {
  const header = document.createElement("header");
  const trigger = button("", "trip-plan-card-toggle");
  trigger.ariaExpanded = String(!collapsed);
  trigger.ariaLabel = `${itemSummary(item)}の詳細を${collapsed ? "開く" : "閉じる"}`;
  trigger.addEventListener("click", () => {
    toggle();
    trigger.ariaExpanded = String(trigger.ariaExpanded !== "true");
    trigger.ariaLabel = `${itemSummary(item)}の詳細を${trigger.ariaExpanded === "true" ? "閉じる" : "開く"}`;
  });
  const copy = document.createElement("span");
  copy.className = "trip-plan-card-heading";
  const label = document.createElement("strong");
  label.textContent = item.type === "movement"
    ? "移動"
    : item.type === "stay" ? "滞在" : "観光";
  const summary = document.createElement("small");
  summary.textContent = itemSummary(item);
  const date = document.createElement("time");
  date.textContent = item.type === "movement"
    ? formatDate(item.mode === "rail" ? item.route.departureDate : item.date)
    : item.type === "stay" ? `${formatDate(item.checkInDate)}から${nights(item.checkInDate, item.checkOutDate)}泊`
      : formatDate(item.date);
  copy.append(label, summary);
  trigger.append(copy);
  if (date.textContent) trigger.append(date);
  const chevron = document.createElement("span");
  chevron.className = "trip-plan-card-chevron";
  chevron.setAttribute("aria-hidden", "true");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#icon-chevron-down");
  icon.append(use);
  chevron.append(icon);
  trigger.append(chevron);
  header.append(trigger);
  return header;
}

function renderInsertionControl(
  previous: TripPlanItem,
  next: TripPlanItem,
  beginChat: (prompt: string) => void,
): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "trip-plan-insertion";
  const add = button("＋ 予定を追加", "trip-plan-insertion-button");
  add.addEventListener("click", () => beginChat(
    `${itemSummary(previous)}と${itemSummary(next)}の間に予定を追加したい。すぐ候補を決めず、まず何をしたいか短く聞いて。希望が分かったら観光・食事などの候補を検索して地図に表示して`,
  ));
  slot.append(add);
  return slot;
}

function renderRailMovement(
  route: Extract<TripPlanItem, { type: "movement"; mode: "rail" }>["route"],
): HTMLElement {
  const body = document.createElement("div");
  body.className = "trip-plan-route";
  const journey = route.journeys[0];
  if (!journey) {
    body.append(paragraph(`${route.originStation} → ${route.destinationStation}`, "trip-plan-route-empty"));
    return body;
  }

  const overview = document.createElement("div");
  overview.className = "trip-plan-route-overview";
  const times = document.createElement("strong");
  times.textContent = `${clock(journey.departureTimeMinutes)} → ${clock(journey.arrivalTimeMinutes)}`;
  const summary = document.createElement("span");
  summary.textContent = `${duration(journey.arrivalTimeMinutes - journey.departureTimeMinutes)}・${journey.transferCount === 0 ? "乗換なし" : `乗換${journey.transferCount}回`}`;
  overview.append(times, summary);
  body.append(overview);

  const legs = document.createElement("ol");
  legs.className = "trip-plan-route-legs";
  journey.legs.forEach((leg, index) => {
    legs.append(renderRouteLeg(leg));
    const next = journey.legs[index + 1];
    if (next) legs.append(renderTransfer(leg, next));
  });
  body.append(legs);
  return body;
}

function renderRouteLeg(leg: JourneyRouteLeg): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "trip-plan-route-leg";
  item.style.setProperty("--trip-route-color", safeColor(leg.lineColor));

  const origin = stationRow(clock(leg.departureTimeMinutes), leg.originStation);
  const service = document.createElement("div");
  service.className = "trip-plan-route-service";
  const serviceName = document.createElement("strong");
  serviceName.textContent = [leg.serviceType, leg.trainName].filter(Boolean).join(" ");
  const destination = document.createElement("span");
  destination.textContent = leg.serviceDestination ? `${leg.serviceDestination}行き` : "";
  service.append(serviceName);
  if (destination.textContent) service.append(destination);
  if (leg.lineName) service.append(paragraph(leg.lineName, "trip-plan-route-line"));
  if (leg.delayMinutes && leg.delayMinutes > 0) {
    const delay = document.createElement("em");
    delay.textContent = `${leg.delayStatus === "estimated" ? "遅延見込み" : "遅延"} +${Math.round(leg.delayMinutes)}分`;
    service.append(delay);
  }

  const destinationRow = stationRow(clock(leg.arrivalTimeMinutes), leg.destinationStation);
  item.append(origin, service, destinationRow);
  return item;
}

function renderTransfer(current: JourneyRouteLeg, next: JourneyRouteLeg): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "trip-plan-transfer";
  const wait = Math.max(0, next.departureTimeMinutes - current.arrivalTimeMinutes);
  item.textContent = `${current.destinationStation}で乗換・${Math.round(wait)}分`;
  return item;
}

function stationRow(time: string, station: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "trip-plan-station";
  const timeElement = document.createElement("time");
  timeElement.textContent = time;
  const stationElement = document.createElement("strong");
  stationElement.textContent = station;
  row.append(timeElement, stationElement);
  return row;
}

function renderManualMovement(
  mode: Exclude<MovementMode, "rail">,
  origin: string,
  destination: string,
  note?: string,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "trip-plan-manual-movement";
  const modeElement = document.createElement("strong");
  modeElement.textContent = movementModeLabel(mode);
  body.append(modeElement, paragraph(`${origin} → ${destination}`));
  if (note) body.append(paragraph(note, "trip-plan-note"));
  return body;
}

function renderStay(
  item: Extract<TripPlanItem, { type: "stay" }>,
  showAccommodationCandidates?: (
    accommodations: readonly ViewerAgentAccommodation[],
    stay: { destination: string; checkInDate: string; checkOutDate: string },
  ) => void,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "trip-plan-stay";
  body.append(paragraph(
    item.accommodation ? "選択した宿泊先" : "宿泊先を選んでください",
    "trip-plan-stay-guidance",
  ));
  if (!item.options?.length) {
    body.append(paragraph(item.accommodation?.name ?? `${item.destination}の宿泊先を相談できます`, "trip-plan-place"));
    const search = button("地図で宿泊先を探す", "trip-plan-stay-map");
    search.addEventListener("click", () => showAccommodationCandidates?.([], item));
    search.disabled = !showAccommodationCandidates;
    body.append(search);
    return body;
  }

  if (item.accommodation) {
    const selected = document.createElement("article");
    selected.className = "trip-plan-selected-stay";
    if (item.accommodation.imageUrl) {
      const image = document.createElement("img");
      image.src = item.accommodation.imageUrl;
      image.alt = "";
      selected.append(image);
    }
    const name = document.createElement("strong");
    name.textContent = item.accommodation.name;
    selected.append(name);
    body.append(selected);
  }
  const choose = button(item.accommodation ? "地図で宿泊先を変更" : "地図で宿泊先を選ぶ", "trip-plan-stay-map");
  choose.addEventListener("click", () => showAccommodationCandidates?.(item.options ?? [], item));
  choose.disabled = !showAccommodationCandidates;
  body.append(choose);
  return body;
}

function itemSummary(item: TripPlanItem): string {
  if (item.type === "movement") {
    return item.mode === "rail"
      ? `${item.route.originStation}から${item.route.destinationStation}への移動`
      : `${item.origin}から${item.destination}への移動`;
  }
  if (item.type === "stay") return `${item.destination}での滞在`;
  return `${item.place.name}の観光`;
}

function consultationPrompt(item: TripPlanItem, plan: TripPlan): string {
  if (item.type === "movement") {
    return item.mode === "rail"
      ? `${item.route.originStation}から${item.route.destinationStation}までの移動を変更したい`
      : `${item.origin}から${item.destination}までの移動を変更したい`;
  }
  if (item.type === "stay") return `${plan.destination}の宿泊先を相談したい`;
  return `${item.place.name}を含む観光の予定を相談したい`;
}

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text: string, className: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  return element;
}

function clock(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1_440) + 1_440) % 1_440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function duration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  return hours > 0 ? `${hours}時間${rounded % 60}分` : `${rounded}分`;
}

function nights(checkInDate: string, checkOutDate: string): number {
  return Math.max(1, Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86_400_000));
}

function formatDate(value?: string): string {
  if (!value) return "";
  const [, month, day] = /^\d{4}-(\d{2})-(\d{2})$/u.exec(value) ?? [];
  return month && day ? `${Number(month)}月${Number(day)}日` : value;
}

function safeColor(value?: string): string {
  return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : "#4a93ff";
}

function movementModeLabel(mode: Exclude<MovementMode, "rail">): string {
  return {
    "rental-car": "レンタカー",
    car: "車",
    bus: "バス",
    walk: "徒歩",
    other: "移動",
  }[mode];
}
