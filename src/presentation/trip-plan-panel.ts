import type { JourneyRouteLeg } from "../domain/direct-route-search";
import {
  applyTripPlanPatches,
  loadTripPlan,
  saveTripPlan,
  selectTripPlanAccommodation,
  type MovementMode,
  type TripPlan,
  type TripPlanItem,
  type TripPlanPatch,
} from "../domain/trip-plan";
import type { ViewerAgentAccommodation } from "../domain/viewer-agent-response";

export interface TripPlanPanelController {
  show(plan: TripPlan): void;
  apply(patches: TripPlanPatch[]): void;
  selectAccommodation(accommodation: ViewerAgentAccommodation): void;
  open(): void;
}

export function configureTripPlanPanel(
  panel: HTMLElement,
  content: HTMLElement,
  close: HTMLButtonElement,
  toggle: HTMLButtonElement,
  beginChat: (prompt: string) => void,
): TripPlanPanelController {
  let plan = loadTripPlan(localStorage);

  const open = () => {
    render();
    panel.hidden = false;
  };
  const render = () => {
    content.replaceChildren();
    toggle.hidden = plan === undefined;
    if (!plan) {
      content.append(paragraph("旅行の相談をすると、ここに旅程が作られます。", "trip-plan-empty"));
      return;
    }

    content.append(renderPlanHeading(plan));
    const cards = document.createElement("div");
    cards.className = "trip-plan-cards";
    for (const item of plan.items) {
      cards.append(renderTripPlanCard(item, plan, beginChat, controller));
    }
    content.append(cards);

    const add = button("＋ 観光を追加", "trip-plan-add");
    add.addEventListener("click", () =>
      beginChat(`${plan?.destination ?? ""}で立ち寄る観光地を探したい`));
    content.append(add);
  };

  const controller: TripPlanPanelController = {
    show(next) {
      plan = next;
      saveTripPlan(localStorage, plan);
      open();
    },
    apply(patches) {
      if (!plan) return;
      plan = applyTripPlanPatches(plan, patches);
      saveTripPlan(localStorage, plan);
      open();
    },
    selectAccommodation(accommodation) {
      if (!plan) return;
      plan = selectTripPlanAccommodation(plan, accommodation);
      saveTripPlan(localStorage, plan);
      render();
    },
    open,
  };

  close.addEventListener("click", () => { panel.hidden = true; });
  toggle.addEventListener("click", open);
  render();
  return controller;
}

function renderPlanHeading(plan: TripPlan): HTMLElement {
  const heading = document.createElement("section");
  heading.className = "trip-plan-heading";
  const eyebrow = document.createElement("span");
  eyebrow.textContent = plan.destination;
  const title = document.createElement("h2");
  title.textContent = plan.title;
  heading.append(eyebrow, title);
  return heading;
}

function renderTripPlanCard(
  item: TripPlanItem,
  plan: TripPlan,
  beginChat: (prompt: string) => void,
  controller: TripPlanPanelController,
): HTMLElement {
  const card = document.createElement("article");
  card.className = `trip-plan-card trip-plan-card-${item.type}`;
  card.append(renderCardHeader(item));

  if (item.type === "movement") {
    card.append(item.mode === "rail"
      ? renderRailMovement(item.route)
      : renderManualMovement(item.mode, item.origin, item.destination, item.note));
  } else if (item.type === "stay") {
    card.append(renderStay(item, controller));
  } else {
    card.append(paragraph(item.place.name, "trip-plan-place"));
  }

  const footer = document.createElement("footer");
  const consult = button("相談する", "trip-plan-consult");
  consult.addEventListener("click", () => beginChat(consultationPrompt(item, plan)));
  footer.append(consult);
  card.append(footer);
  return card;
}

function renderCardHeader(item: TripPlanItem): HTMLElement {
  const header = document.createElement("header");
  const label = document.createElement("strong");
  label.textContent = item.type === "movement"
    ? "移動"
    : item.type === "stay" ? "滞在" : "観光";
  const date = document.createElement("span");
  date.textContent = item.type === "movement"
    ? formatDate(item.mode === "rail" ? item.route.departureDate : item.date)
    : item.type === "stay" ? `${formatDate(item.checkInDate)}から${nights(item.checkInDate, item.checkOutDate)}泊`
      : formatDate(item.date);
  header.append(label);
  if (date.textContent) header.append(date);
  return header;
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
  controller: TripPlanPanelController,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "trip-plan-stay";
  body.append(paragraph(item.accommodation?.name ?? item.destination, "trip-plan-place"));
  if (!item.options?.length) return body;

  const options = document.createElement("div");
  options.className = "trip-plan-stay-options";
  for (const accommodation of item.options) {
    const select = button("", "trip-plan-stay-option");
    select.ariaPressed = String(item.accommodation?.name === accommodation.name);
    if (accommodation.imageUrl) {
      const image = document.createElement("img");
      image.src = accommodation.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      select.append(image);
    }
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = accommodation.name;
    copy.append(name);
    if (accommodation.areaName) copy.append(paragraph(accommodation.areaName));
    select.append(copy);
    select.addEventListener("click", () => controller.selectAccommodation(accommodation));
    options.append(select);
  }
  body.append(options);
  return body;
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
