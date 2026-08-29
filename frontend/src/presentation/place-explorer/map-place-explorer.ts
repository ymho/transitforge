import type { PlaceMedia } from "@raiquora/trip/place-media";

export interface MapPlaceCardModel {
  id: string;
  name: string;
  summary?: string;
  sourceUrl: string;
  image?: { url: string; attribution: string };
}

export interface MapPlaceExplorerController {
  show(places: readonly PlaceMedia[]): void;
  select(providerPlaceId: string, focusMap?: boolean): void;
  clear(): void;
}

export function mapPlaceCardModels(places: readonly PlaceMedia[]): MapPlaceCardModel[] {
  return places
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .map((place) => ({
      id: place.providerPlaceId,
      name: place.name,
      ...(place.summary ? { summary: place.summary } : {}),
      sourceUrl: place.sourceUrl,
      ...(place.image?.hotlinkAllowed === true
        ? { image: { url: place.image.url, attribution: place.image.attribution } }
        : {}),
    }));
}

export function configureMapPlaceExplorer(options: {
  panel: HTMLElement;
  list: HTMLElement;
  close: HTMLButtonElement;
  focusPlace: (providerPlaceId: string) => void;
  consult: (place: PlaceMedia) => void;
  clearPlaces?: () => void;
}): MapPlaceExplorerController {
  let placesById = new Map<string, PlaceMedia>();

  const select = (providerPlaceId: string, focusMap = true) => {
    const card = Array.from(options.list.querySelectorAll<HTMLElement>("[data-place-id]"))
      .find((candidate) => candidate.dataset.placeId === providerPlaceId);
    if (!card) return;
    for (const candidate of options.list.querySelectorAll<HTMLElement>("[data-place-id]")) {
      candidate.toggleAttribute("data-selected", candidate === card);
      candidate.setAttribute("aria-current", candidate === card ? "true" : "false");
    }
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    if (focusMap) options.focusPlace(providerPlaceId);
  };

  const reset = () => {
    placesById.clear();
    options.list.replaceChildren();
    options.panel.hidden = true;
  };

  const clear = () => {
    reset();
    options.clearPlaces?.();
  };

  options.close.addEventListener("click", clear);

  return {
    show(places) {
      reset();
      const models = mapPlaceCardModels(places);
      placesById = new Map(places.map((place) => [place.providerPlaceId, place]));
      for (const model of models) {
        options.list.append(renderPlaceCard(model, () => select(model.id), () => {
          const place = placesById.get(model.id);
          if (place) options.consult(place);
        }));
      }
      options.panel.hidden = models.length === 0;
    },
    select,
    clear,
  };
}

function renderPlaceCard(
  place: MapPlaceCardModel,
  select: () => void,
  consult: () => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "map-place-option";
  card.dataset.placeId = place.id;
  card.setAttribute("aria-current", "false");

  const focus = document.createElement("button");
  focus.type = "button";
  focus.className = "map-place-option-focus";
  focus.ariaLabel = `${place.name}を地図で見る`;
  if (place.image) {
    const image = document.createElement("img");
    image.src = place.image.url;
    image.alt = "";
    image.loading = "lazy";
    focus.append(image);
  }
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = place.name;
  copy.append(name);
  if (place.summary) {
    const summary = document.createElement("small");
    summary.textContent = place.summary;
    copy.append(summary);
  }
  focus.append(copy);
  focus.addEventListener("click", select);

  const footer = document.createElement("footer");
  const source = document.createElement("a");
  source.href = place.sourceUrl;
  source.target = "_blank";
  source.rel = "noreferrer noopener";
  source.textContent = place.image?.attribution ?? "情報源";
  const action = document.createElement("button");
  action.type = "button";
  action.textContent = "旅程を相談";
  action.addEventListener("click", consult);
  footer.append(source, action);
  card.append(focus, footer);
  return card;
}
