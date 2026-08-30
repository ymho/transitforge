import type { PlaceMedia } from "@raiquora/trip/place-media";
import type { MapTravelCandidate } from "../../domain/map-travel-candidate";

export interface MapPlaceCardModel {
  id: string;
  name: string;
  address?: string;
  summary?: string;
  sourceUrl: string;
  sources: NonNullable<PlaceMedia["sources"]>;
  image?: { url: string; attribution: string };
  images: Array<{ url: string; attribution: string }>;
  openingHours?: string;
  categories: string[];
  kind: MapTravelCandidate["kind"];
  primaryLabel: string;
  reviewLabel?: string;
  priceLabel?: string;
  availabilityLabel?: string;
  budget?: string;
  detail?: PlaceMedia["detail"];
}

export interface MapPlaceExplorerController {
  show(candidates: readonly MapTravelCandidate[]): void;
  select(providerPlaceId: string, focusMap?: boolean): void;
  clear(): void;
}

export function mapPlaceCardModels(places: readonly PlaceMedia[]): MapPlaceCardModel[] {
  return mapTravelCandidateCardModels(places.flatMap((place) =>
    Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? [{
      kind: "place" as const,
      id: place.providerPlaceId,
      name: place.name,
      latitude: place.latitude!,
      longitude: place.longitude!,
      ...(place.address ? { address: place.address } : {}),
      ...(place.summary ? { summary: place.summary } : {}),
      ...(place.categories ? { categories: place.categories } : {}),
      ...(place.image?.hotlinkAllowed === true ? { imageUrl: place.image.url } : {}),
      sourceUrl: place.sourceUrl,
      value: place,
    }] : []));
}

export function mapTravelCandidateCardModels(candidates: readonly MapTravelCandidate[]): MapPlaceCardModel[] {
  return candidates.map((candidate) => {
    const place = candidate.kind === "place" ? candidate.value : undefined;
    const sourceUrl = candidate.sourceUrl ?? "https://example.invalid/";
    const reviewAverage = candidate.kind === "accommodation"
      ? candidate.reviewAverage
      : place?.reviewAverage;
    const reviewCount = candidate.kind === "accommodation"
      ? candidate.reviewCount
      : place?.reviewCount;
    const reviewLabel = reviewAverage !== undefined
      ? `★ ${reviewAverage.toFixed(1)}${reviewCount !== undefined ? `（${reviewCount.toLocaleString("ja-JP")}件）` : ""}`
      : undefined;
    const images = place
      ? (place.images ?? (place.image ? [place.image] : []))
          .filter(({ hotlinkAllowed }) => hotlinkAllowed === true)
          .map(({ url, attribution }) => ({ url, attribution }))
      : candidate.imageUrl ? [{ url: candidate.imageUrl, attribution: "提供画像" }] : [];
    return {
      id: candidate.id,
      kind: candidate.kind,
      name: candidate.name,
      ...(candidate.address ? { address: candidate.address } : {}),
      ...(candidate.summary ? { summary: candidate.summary } : {}),
      sourceUrl,
      sources: place?.sources ?? [{ provider: "source", label: "情報源", url: sourceUrl, role: "identity" }],
      categories: candidate.categories ?? [],
      images,
      primaryLabel: candidate.kind === "accommodation" ? "この宿を選ぶ" : "旅程を相談",
      ...(candidate.kind === "restaurant" && candidate.openingHours ? { openingHours: candidate.openingHours } : {}),
      ...(place?.openingHoursStatus === "available" && place.openingHours ? { openingHours: place.openingHours } : {}),
      ...(candidate.imageUrl ? { image: { url: candidate.imageUrl, attribution: place?.image?.attribution ?? "提供画像" } } : {}),
      ...(reviewLabel ? { reviewLabel } : {}),
      ...(candidate.kind === "accommodation" && candidate.priceLabel ? { priceLabel: candidate.priceLabel } : {}),
      ...(candidate.kind === "accommodation" && candidate.availabilityLabel ? { availabilityLabel: candidate.availabilityLabel } : {}),
      ...(candidate.kind === "restaurant" && candidate.budget ? { budget: candidate.budget } : {}),
      ...(place?.detail ? { detail: place.detail } : {}),
    };
  });
}

export function configureMapPlaceExplorer(options: {
  panel: HTMLElement;
  list: HTMLElement;
  close: HTMLButtonElement;
  detail: HTMLElement;
  detailContent: HTMLElement;
  closeDetail: HTMLButtonElement;
  focusPlace: (providerPlaceId: string) => void;
  choose: (candidate: MapTravelCandidate) => void;
  clearPlaces?: () => void;
  loadDetail?: (candidate: MapTravelCandidate) => Promise<MapTravelCandidate>;
}): MapPlaceExplorerController {
  let candidatesById = new Map<string, MapTravelCandidate>();
  let detailRequest = 0;

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
    const candidate = candidatesById.get(providerPlaceId);
    if (candidate) void showPlaceDetail(candidate);
  };

  const showPlaceDetail = async (candidate: MapTravelCandidate) => {
    const model = mapTravelCandidateCardModels([candidate])[0];
    if (!model) return;
    options.detailContent.replaceChildren(renderPlaceDetail(model, () => options.choose(candidate)));
    options.detail.hidden = false;
    if (!options.loadDetail || candidate.kind !== "place") return;
    const request = ++detailRequest;
    options.detail.dataset.loading = "true";
    try {
      const detailed = await options.loadDetail(candidate);
      if (request !== detailRequest || options.detail.hidden) return;
      candidatesById.set(candidate.id, detailed);
      const detailedModel = mapTravelCandidateCardModels([detailed])[0];
      if (detailedModel) {
        options.detailContent.replaceChildren(
          renderPlaceDetail(detailedModel, () => options.choose(detailed)),
        );
      }
    } finally {
      if (request === detailRequest) delete options.detail.dataset.loading;
    }
  };

  const closeDetail = () => {
    detailRequest += 1;
    options.detail.hidden = true;
    options.detailContent.replaceChildren();
  };

  const reset = () => {
    candidatesById.clear();
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
    show(candidates) {
      reset();
      const models = mapTravelCandidateCardModels(candidates);
      const heading = options.panel.querySelector("header strong");
      if (heading) {
        const kind = candidates[0]?.kind;
        heading.textContent = kind === "accommodation"
          ? "宿泊先候補"
          : kind === "restaurant" ? "食事候補" : "地図で見つけたスポット";
      }
      candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      for (const model of models) {
        options.list.append(renderPlaceCard(model, () => select(model.id), () => {
          const candidate = candidatesById.get(model.id);
          if (candidate) options.choose(candidate);
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

  if (place.images.length > 0) {
    article.append(renderPlaceGallery(place));
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

  if (place.openingHours || place.reviewLabel || place.priceLabel || place.availabilityLabel || place.budget) {
    const facts = document.createElement("ul");
    facts.className = "map-place-detail-facts";
    for (const [label, fact] of [
      ["評価", place.reviewLabel],
      ["営業時間", place.openingHours],
      ["料金", place.priceLabel ?? place.budget],
      ["空き状況", place.availabilityLabel],
    ] as const) {
      if (!fact) continue;
      const item = document.createElement("li");
      const caption = document.createElement("small");
      caption.textContent = label;
      const value = document.createElement("strong");
      value.textContent = fact;
      item.append(caption, value);
      facts.append(item);
    }
    body.append(facts);
  }

  if (place.address) {
    const address = document.createElement("p");
    address.className = "map-place-detail-address";
    address.textContent = place.address;
    body.append(address);
  }

  const overview = place.detail?.overview ?? place.summary;
  if (overview) {
    const summary = document.createElement("p");
    summary.className = "map-place-detail-summary";
    summary.textContent = overview;
    body.append(summary);
  }

  appendDetailSection(body, "見どころ", place.detail?.highlights);
  appendDetailSection(body, "雰囲気", place.detail?.atmosphere ? [place.detail.atmosphere] : undefined);
  appendDetailSection(body, "知っておくと便利", place.detail?.tips);
  appendDetailSection(body, "周辺で立ち寄れる場所", place.detail?.nearby);

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
  addToTrip.textContent = place.primaryLabel;
  addToTrip.addEventListener("click", consult);
  actions.append(sources, addToTrip);
  body.append(actions);
  article.append(body);
  return article;
}

function renderPlaceGallery(place: MapPlaceCardModel): HTMLElement {
  const gallery = document.createElement("div");
  gallery.className = "map-place-detail-gallery";
  const track = document.createElement("div");
  track.className = "map-place-detail-gallery-track";
  const dots = document.createElement("div");
  dots.className = "map-place-detail-gallery-dots";
  const figures: HTMLElement[] = [];
  for (const [index, item] of place.images.slice(0, 6).entries()) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = `${place.name}の写真 ${index + 1}`;
    image.loading = index === 0 ? "eager" : "lazy";
    const credit = document.createElement("figcaption");
    credit.textContent = item.attribution;
    figure.append(image, credit);
    figures.push(figure);
    track.append(figure);
    const dot = document.createElement("button");
    dot.type = "button";
    dot.ariaLabel = `${index + 1}枚目の写真を表示`;
    dot.toggleAttribute("data-active", index === 0);
    dot.addEventListener("click", () => figure.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" }));
    dots.append(dot);
  }
  track.addEventListener("scroll", () => {
    const index = Math.max(0, Math.min(figures.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
    for (const [dotIndex, dot] of Array.from(dots.children).entries()) {
      dot.toggleAttribute("data-active", dotIndex === index);
    }
  }, { passive: true });
  gallery.append(track, dots);
  return gallery;
}

function appendDetailSection(
  container: HTMLElement,
  headingText: string,
  values?: readonly string[],
): void {
  const items = values?.filter(Boolean).slice(0, 6) ?? [];
  if (items.length === 0) return;
  const section = document.createElement("section");
  section.className = "map-place-detail-section";
  const heading = document.createElement("h3");
  heading.textContent = headingText;
  if (items.length === 1) {
    const paragraph = document.createElement("p");
    paragraph.textContent = items[0]!;
    section.append(heading, paragraph);
  } else {
    const list = document.createElement("ul");
    for (const value of items) {
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
    }
    section.append(heading, list);
  }
  container.append(section);
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
  const facts = [place.reviewLabel, place.priceLabel, place.availabilityLabel, place.budget].filter(Boolean);
  if (facts.length > 0) {
    const metadata = document.createElement("small");
    metadata.className = "map-place-option-facts";
    metadata.textContent = facts.join("・");
    copy.append(metadata);
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
  action.textContent = place.primaryLabel;
  action.addEventListener("click", consult);
  footer.append(source, action);
  card.append(focus, footer);
  return card;
}
