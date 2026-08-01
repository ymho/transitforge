import type { DirectRouteResult } from "../domain/direct-route-search";

export interface RouteSearchResponse {
  originStation: string;
  distanceMeters?: number;
  results: DirectRouteResult[];
}

export interface RouteSearchPanelElements {
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  close: HTMLButtonElement;
  form: HTMLFormElement;
  origin: HTMLInputElement;
  destination: HTMLInputElement;
  departureTime: HTMLInputElement;
  submit: HTMLButtonElement;
  status: HTMLElement;
  results: HTMLOListElement;
  stations: HTMLDataListElement;
}

export type RouteSearchHandler = (request: {
  originStation?: string;
  destinationStation: string;
  departureTimeMinutes: number;
}) => Promise<RouteSearchResponse>;

export function configureRouteSearchPanel(
  elements: RouteSearchPanelElements,
  stationNames: string[],
  getDefaultDepartureTime: () => number,
  search: RouteSearchHandler,
  select: (result: DirectRouteResult) => void,
): { close: () => void } {
  const {
    panel, toggle, close, form, origin, destination, departureTime,
    submit, status, results, stations,
  } = elements;
  stations.replaceChildren(
    ...stationNames.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      return option;
    }),
  );

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.ariaExpanded = String(open);
    if (open && !departureTime.value) {
      departureTime.value = formatRouteTime(getDefaultDepartureTime());
    } else if (!open) {
      toggle.focus();
    }
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const destinationStation = destination.value.trim();
    const departureTimeMinutes = parseRouteTime(departureTime.value);
    if (!destinationStation || departureTimeMinutes === undefined || submit.disabled) {
      status.textContent = "行き先と出発時刻を確認してください。";
      return;
    }
    submit.disabled = true;
    status.textContent = origin.value.trim()
      ? "直通列車を探しています。"
      : "現在地から利用できる最寄り駅を探しています。";
    results.replaceChildren();
    void search({
      ...(origin.value.trim() ? { originStation: origin.value.trim() } : {}),
      destinationStation,
      departureTimeMinutes,
    }).then((response) => {
      origin.value = response.originStation;
      const distance = response.distanceMeters === undefined
        ? ""
        : `（現在地から約${formatDistance(response.distanceMeters)}）`;
      status.textContent = response.results.length > 0
        ? `${response.originStation}${distance}から乗り換えなしで行ける列車です。`
        : `${response.originStation}から指定時刻以降の直通列車は見つかりませんでした。`;
      renderResults(results, response.results, select);
    }).catch((error) => {
      status.textContent = error instanceof Error
        ? error.message
        : "経路を検索できませんでした。";
    }).finally(() => {
      submit.disabled = false;
    });
  });

  return { close: () => setOpen(false) };
}

export function parseRouteTime(value: string): number | undefined {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 29 ? hours * 60 + minutes : undefined;
}

function renderResults(
  list: HTMLOListElement,
  routeResults: DirectRouteResult[],
  select: (result: DirectRouteResult) => void,
): void {
  for (const result of routeResults) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = [result.train.service_type, result.train.train_name]
      .filter(Boolean).join(" ");
    button.innerHTML =
      `<strong>${formatRouteTime(result.departureTimeMinutes)} → ` +
      `${formatRouteTime(result.arrivalTimeMinutes)}</strong>` +
      `<span>${escapeHtml(name || result.train.train_no)} ` +
      `${escapeHtml(result.train.train_no)}</span>`;
    button.addEventListener("click", () => select(result));
    item.append(button);
    list.append(item);
  }
}

function formatRouteTime(value: number): string {
  const minutes = Math.round(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:` +
    `${String(minutes % 60).padStart(2, "0")}`;
}

function formatDistance(meters: number): string {
  return meters < 1_000 ? `${Math.round(meters / 10) * 10}m` : `${(meters / 1_000).toFixed(1)}km`;
}

function escapeHtml(value: string): string {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
