import { parsePublicPlacePresentation, type PublicPlacePresentation } from "@raiquora/agent/public-place-presentation";
import "./public-place-presentation.css";

/** Render an admitted display snapshot only. No Provider fetch, image fallback,
 * Trip writer, or re-interpretation of the assistant's prose lives in this view. */
export function renderPublicPlacePresentation(input: PublicPlacePresentation): HTMLElement {
  const value = parsePublicPlacePresentation(input);
  const section = document.createElement("section");
  section.className = "public-place-presentation";
  section.setAttribute("aria-label", "旅先の候補");
  for (const place of value.cards) {
    const card = document.createElement("article");
    card.className = "public-place-card";
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
    section.append(card);
  }
  return section;
}
