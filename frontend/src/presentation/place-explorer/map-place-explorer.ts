import type { PlaceMedia } from "@raiquora/trip/place-media";

export interface MapPlaceCardModel {
  id: string;
  name: string;
  address?: string;
  summary?: string;
  sourceUrl: string;
  sources: NonNullable<PlaceMedia["sources"]>;
  image?: { url: string; attribution: string };
  openingHours?: string;
  categories: string[];
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
      ...(place.address ? { address: place.address } : {}),
      ...(place.summary ? { summary: place.summary } : {}),
      sourceUrl: place.sourceUrl,
      sources: place.sources ?? [{ provider: "source", label: "情報源", url: place.sourceUrl, role: "identity" }],
      categories: place.categories ?? [],
      ...(place.openingHoursStatus === "available" && place.openingHours
        ? { openingHours: place.openingHours }
        : {}),
      ...(place.image?.hotlinkAllowed === true
        ? { image: { url: place.image.url, attribution: place.image.attribution } }
        : {}),
    }));
}

export function configureMapPlaceExplorer(options: {
  panel: HTMLElement;
  list: HTMLElement;
  close: HTMLButtonElement;
  detail: HTMLElement;
  detailContent: HTMLElement;
  closeDetail: HTMLButtonElement;
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
    const place = placesById.get(providerPlaceId);
    if (place) showPlaceDetail(place);
  };

  const showPlaceDetail = (place: PlaceMedia) => {
    const model = mapPlaceCardModels([place])[0];
    if (!model) return;
    options.detailContent.replaceChildren(renderPlaceDetail(model, () => options.consult(place)));
    options.detail.hidden = false;
  };

  const closeDetail = () => {
    options.detail.hidden = true;
    options.detailContent.replaceChildren();
  };

  const reset = () => {
    placesById.clear();
    options.list.replaceChildren();
    options.panel.hidden = true;
    closeDetail();
  };

  const clear = () => {
    reset();
    options.clearPlaces?.();
  };

  options.close.addEventListener("click", clear);
  options.closeDetail.addEventListener("click", closeDetail);

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

function renderPlaceDetail(
  place: MapPlaceCardModel,
  consult: () => void,
): HTMLElement {
  const article = document.createElement("article");
  article.className = "map-place-detail-article";

  if (place.image) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = place.image.url;
    image.alt = `${place.name}の写真`;
    const credit = document.createElement("figcaption");
    credit.textContent = place.image.attribution;
    figure.append(image, credit);
    article.append(figure);
  }

  const body = document.createElement("div");
  body.className = "map-place-detail-body";
  const heading = document.createElement("h2");
  heading.textContent = place.name;
  body.append(heading);

  if (place.categories.length > 0) {
    const categories = document.createElement("ul");
    categories.className = "map-place-detail-categories";
    for (const category of place.categories.slice(0, 4)) {
      const item = document.createElement("li");
      item.textContent = category;
      categories.append(item);
    }
    body.append(categories);
  }

  if (place.openingHours) {
    const openingHours = document.createElement("p");
    openingHours.className = "map-place-detail-hours";
    openingHours.textContent = place.openingHours;
    body.append(openingHours);
  }

  if (place.address) {
    const address = document.createElement("p");
    address.className = "map-place-detail-address";
    address.textContent = place.address;
    body.append(address);
  }

  if (place.summary) {
    const summary = document.createElement("p");
    summary.className = "map-place-detail-summary";
    summary.textContent = place.summary;
    body.append(summary);
  }

  const actions = document.createElement("div");
  actions.className = "map-place-detail-actions";
  const sources = document.createElement("div");
  sources.className = "map-place-detail-sources";
  for (const item of place.sources) {
    const source = document.createElement("a");
    source.href = item.url;
    source.target = "_blank";
    source.rel = "noreferrer noopener";
    source.textContent = item.label;
    sources.append(source);
  }
  const addToTrip = document.createElement("button");
  addToTrip.type = "button";
  addToTrip.textContent = "旅程を相談";
  addToTrip.addEventListener("click", consult);
  actions.append(sources, addToTrip);
  body.append(actions);
  article.append(body);
  return article;
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
