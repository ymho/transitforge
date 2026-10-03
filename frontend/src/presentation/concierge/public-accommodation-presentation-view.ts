import { parsePublicAccommodationPresentation, type PublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";

export function renderPublicAccommodationPresentation(input: PublicAccommodationPresentation): HTMLElement {
  const value = parsePublicAccommodationPresentation(input);
  const section = document.createElement("section"); section.className = "public-accommodation-presentation"; section.setAttribute("aria-label", "宿泊候補の比較");
  for (const hotel of value.cards) {
    const card = document.createElement("article"); card.className = "public-place-card";
    const name = document.createElement("h3"); name.textContent = hotel.name;
    const summary = document.createElement("p"); summary.style.whiteSpace = "pre-line"; summary.textContent = hotel.summary;
    const observed = document.createElement("p"); observed.textContent = `取得日時: ${new Date(hotel.retrievedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）`;
    card.append(name, summary, observed);
    if (hotel.sourceUrl) { const source = document.createElement("a"); source.href = hotel.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = "宿の詳細・最新料金を確認 ↗"; card.append(source); }
    section.append(card);
  }
  return section;
}
