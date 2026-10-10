import { accommodationPublicUrl, type AccommodationSnapshot } from "@raiquora/trip/accommodation-snapshot";
import { formatMoney } from "@raiquora/trip/money";
import { element } from "./trip-workspace-elements";
import "./trip-stay-details.css";
import { rakutenAccommodationLink } from "../shared/rakuten-accommodation-link";

export function renderStayDetails(stay: AccommodationSnapshot): HTMLElement | undefined {
  const details = stay.observedDetails;
  const sourceUrl = accommodationPublicUrl(details?.sourceUrl) ?? (stay.provider === "rakuten-travel" && /^[1-9][0-9]*$/u.test(stay.providerItemId)
    ? `https://travel.rakuten.co.jp/HOTEL/${stay.providerItemId}/${stay.providerItemId}.html` : undefined);
  const imageUrl = accommodationPublicUrl(details?.imageUrl, true);
  if (!details && !sourceUrl && !stay.observedPrice) return undefined;
  const root = element("section", "trip-stay-details"); root.setAttribute("aria-label", "宿泊先の検索情報");
  if (imageUrl) {
    const photo = element("img", "trip-stay-photo"); photo.src = imageUrl; photo.alt = stay.place.name; photo.loading = "lazy"; photo.referrerPolicy = "no-referrer";
    photo.addEventListener("error", () => photo.remove()); root.append(photo);
  }
  const facts = element("dl", "trip-stay-facts");
  if (details?.reviewAverage !== undefined) {
    const rating = details.reviewAverage, value = element("dd"), stars = element("span", "trip-stay-stars", "★★★★★"), fill = element("span", "", "★★★★★");
    stars.setAttribute("aria-hidden", "true"); fill.style.width = `${Number((rating * 20).toFixed(2))}%`; stars.append(fill);
    value.setAttribute("aria-label", `5点満点中${rating}`); value.append(stars, document.createTextNode(` ${rating.toFixed(2)}${details.reviewCount !== undefined ? `（${details.reviewCount}件）` : ""}`));
    facts.append(element("dt", "", "評価"), value);
  }
  if (stay.observedPrice) facts.append(element("dt", "", "検索時の参考料金"), element("dd", "", `${formatMoney(stay.observedPrice.price)}${stay.observedPrice.basis === "reference-minimum" ? "〜 / 1室1泊" : ""}`));
  if (facts.childElementCount) root.append(facts);
  if (sourceUrl) {
    const link = element("a", "trip-stay-booking-link", "宿の詳細・予約へ ↗"); link.href = rakutenAccommodationLink(sourceUrl, { checkInDate: stay.checkInDate, checkOutDate: stay.checkOutDate }); link.target = "_blank"; link.rel = "noopener noreferrer"; root.append(link);
  }
  const at = details?.observedAt ?? stay.observedPrice?.observedAt;
  const footer = element("footer", "trip-stay-source");
  if (at) footer.append(element("small", "", `検索時: ${new Date(at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`));
  if (stay.provider === "rakuten-travel") footer.append(element("small", "", "楽天トラベル"));
  if (footer.childElementCount) root.append(footer);
  return root;
}
