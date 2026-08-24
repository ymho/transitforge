import {
  applyTripPlanPatches,
  loadTripPlan,
  saveTripPlan,
  selectTripPlanAccommodation,
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
      const empty = document.createElement("p");
      empty.className = "trip-plan-empty";
      empty.textContent = "旅行の相談をすると、ここに旅程が作られます。";
      content.append(empty);
      return;
    }

    const title = document.createElement("h2");
    title.textContent = plan.title;
    content.append(title);
    for (const item of plan.items) {
      content.append(renderTripPlanItem(item, plan, beginChat, controller));
    }

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "＋ 観光を追加";
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

function renderTripPlanItem(
  item: TripPlanItem,
  plan: TripPlan,
  beginChat: (prompt: string) => void,
  controller: TripPlanPanelController,
): HTMLElement {
  const section = document.createElement("section");
  section.className = `trip-plan-item trip-plan-item-${item.type}`;

  const heading = document.createElement("strong");
  heading.textContent = item.type === "movement"
    ? "移動"
    : item.type === "stay" ? "滞在" : "観光";
  section.append(heading);

  const summary = document.createElement("p");
  if (item.type === "movement") {
    if (item.mode === "rail") {
      const journey = item.route.journeys[0];
      summary.textContent = journey
        ? `${item.route.originStation} → ${item.route.destinationStation}　${clock(journey.departureTimeMinutes)} → ${clock(journey.arrivalTimeMinutes)}`
        : `${item.route.originStation} → ${item.route.destinationStation}`;
    } else {
      summary.textContent = `${movementModeLabel(item.mode)}　${item.origin} → ${item.destination}`;
    }
  } else if (item.type === "stay") {
    summary.textContent = `${item.accommodation?.name ?? item.destination}　${item.checkInDate} → ${item.checkOutDate}`;
  } else {
    summary.textContent = item.place.name;
  }
  section.append(summary);

  if (item.type === "stay" && item.options?.length) {
    const options = document.createElement("div");
    options.className = "trip-plan-stay-options";
    for (const accommodation of item.options) {
      const select = document.createElement("button");
      select.type = "button";
      select.textContent = accommodation.name;
      select.ariaPressed = String(item.accommodation?.name === accommodation.name);
      select.addEventListener("click", () => controller.selectAccommodation(accommodation));
      options.append(select);
    }
    section.append(options);
  }

  const consult = document.createElement("button");
  consult.type = "button";
  consult.className = "trip-plan-consult";
  consult.textContent = "相談する";
  consult.addEventListener("click", () => beginChat(consultationPrompt(item, plan)));
  section.append(consult);
  return section;
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

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function movementModeLabel(mode: Exclude<import("../domain/trip-plan").MovementMode, "rail">): string {
  return {
    "rental-car": "レンタカー",
    car: "車",
    bus: "バス",
    walk: "徒歩",
    other: "移動",
  }[mode];
}
