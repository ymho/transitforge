import { parsePublicPlacePresentation, type PublicPlaceCard, type PublicPlacePresentation } from "@raiquora/agent/public-place-presentation";
import type { ActivityCategory } from "@raiquora/trip/trip";
import { researchDateLabel } from "../../usecases/trip-plan/research-date";
import "./public-place-presentation.css";

/** Render an admitted display snapshot only. No Provider fetch, image fallback,
 * Trip writer, or re-interpretation of the assistant's prose lives in this view. */
export function renderPublicPlacePresentation(input: PublicPlacePresentation, selection?: {
  days(): readonly { key: string; label: string }[];
  propose(card: PublicPlaceCard, dayKey: string, category: ActivityCategory): void;
}): HTMLElement {
  const value = parsePublicPlacePresentation(input);
  const section = document.createElement("section");
  section.className = "public-place-presentation";
  section.setAttribute("aria-label", "旅先の候補");
  for (const place of value.cards) {
    const card = document.createElement("article");
    card.className = "public-place-card";
    if (place.photo) {
      const figure = document.createElement("figure");
      figure.className = "public-place-photo";
      const image = document.createElement("img");
      image.src = place.photo.url;
      image.alt = `${place.title}の写真`;
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      const caption = document.createElement("figcaption");
      const credit = document.createElement("a");
      credit.href = place.photo.sourceUrl;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      credit.textContent = `写真: ${place.photo.attribution}${place.photo.license ? ` (${place.photo.license})` : ""}`;
      credit.setAttribute("aria-label", `${place.title}の写真の出典を開く`);
      caption.append(credit);
      figure.append(image, caption);
      card.append(figure);
    }
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = place.title;
    const source = document.createElement("a");
    source.className = "public-place-source";
    source.href = place.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = "出典 ↗";
    source.setAttribute("aria-label", `${place.title}の出典を開く`);
    header.append(title, source);
    const excerpt = document.createElement("blockquote");
    excerpt.textContent = place.description;
    excerpt.setAttribute("aria-label", "資料の抜粋");
    card.append(header, excerpt);
    if (place.retrievedAt) {
      const asOf = document.createElement("p");
      asOf.textContent = `参照資料は${researchDateLabel(place.retrievedAt)}時点（日本時間）。最新情報は改めて確認してください。`;
      card.append(asOf);
    }
    if (selection && place.retrievedAt && place.sourceUrl.startsWith("https://")) {
      const form = document.createElement("form"); form.hidden = true;
      const dayLabel = document.createElement("label"); dayLabel.textContent = "追加する日 ";
      const day = document.createElement("select"); day.required = true; dayLabel.append(day);
      const kindLabel = document.createElement("label"); kindLabel.textContent = "予定の種類 ";
      const kind = document.createElement("select");
      for (const [value, label] of [["sightseeing", "観光"], ["food", "食事"], ["event", "イベント"], ["experience", "体験"]] as const) {
        const option = document.createElement("option"); option.value = value; option.textContent = label; kind.append(option);
      }
      kindLabel.append(kind);
      const trigger = document.createElement("button"); trigger.type = "button"; trigger.textContent = "旅程に追加案";
      const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "追加案を確認";
      const status = document.createElement("p"); status.setAttribute("role", "status");
      trigger.addEventListener("click", () => {
        const days = selection.days();
        if (!days.length) { status.textContent = "旅程を開いてから追加してください。"; return; }
        day.replaceChildren(...days.map(({ key, label }) => { const option = document.createElement("option"); option.value = key; option.textContent = label; return option; }));
        form.hidden = false; day.focus();
      });
      form.append(dayLabel, kindLabel, submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        try { selection.propose(place, day.value, kind.value as ActivityCategory); status.textContent = "旅程に追加案を表示しました。まだ保存していません。"; }
        catch { status.textContent = "旅程が変わったため追加案を作れませんでした。最新の旅程を確認してください。"; }
      });
      card.append(trigger, form, status);
    }
    section.append(card);
  }
  return section;
}
