// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { AccommodationSnapshot } from "@raiquora/trip/accommodation-snapshot";
import { renderStayDetails } from "./trip-stay-details";
const at = "2026-10-10T00:00:00Z";
function stay(): AccommodationSnapshot { return { provider: "rakuten-travel", providerItemId: "42", selectedAt: at,
  place: { name: "宿", sources: [] }, checkInDate: "2026-10-24", checkOutDate: "2026-10-25", sources: [],
  observedPrice: { price: { currency: "JPY", amountMinor: 10850 }, basis: "reference-minimum", observedAt: at },
  observedDetails: { observedAt: at, imageUrl: "https://example.org/photo.jpg", reviewAverage: 4.35, reviewCount: 100, sourceUrl: "https://example.org/hotel/42" } }; }
it("shows search-time photos, review stars, price and an external reservation link after restoration", () => {
  const root = renderStayDetails(JSON.parse(JSON.stringify(stay())))!;
  expect(root.querySelector<HTMLImageElement>("img")?.src).toBe("https://example.org/photo.jpg");
  expect(root.querySelector('[aria-label="5点満点中4.35"]')?.textContent).toContain("100件");
  expect(root.textContent).toContain("JPY 10,850〜 / 1室1泊");
  expect(root.textContent).toContain("検索時"); expect(root.textContent).toContain("楽天トラベル");
  const link = root.querySelector<HTMLAnchorElement>("a")!;
  expect(link.href).toBe("https://example.org/hotel/42"); expect(link.rel).toBe("noopener noreferrer"); expect(link.target).toBe("_blank");
  expect([...root.children].map(node => node.tagName)).toEqual(["IMG", "DL", "A", "FOOTER"]);
  expect([...root.querySelectorAll("dt")].map(node => node.textContent)).toEqual(["楽天トラベル", "評価", "検索時の料金"]);
  expect(root.querySelector("footer")?.textContent).toBe("検索時: 2026/10/10 09:00:00");
  root.querySelector("img")!.dispatchEvent(new Event("error")); expect(root.querySelector("img")).toBeNull();
});
it("links legacy Rakuten stays by verified facility ID without inventing pictures, ratings or prices", () => {
  const old = stay(); delete (old as { observedDetails?: unknown }).observedDetails; delete (old as { observedPrice?: unknown }).observedPrice;
  const root = renderStayDetails(old)!;
  expect(root.querySelector<HTMLAnchorElement>("a")?.href).toBe("https://hotel.travel.rakuten.co.jp/hotelinfo/plan/42?f_nen1=2026&f_tuki1=10&f_hi1=24&f_nen2=2026&f_tuki2=10&f_hi2=25&f_heya_su=1&f_static=0");
  expect(root.querySelector("img")).toBeNull(); expect(root.querySelector(".trip-facility-name")?.textContent).toBe("宿");
  expect(renderStayDetails({ ...old, provider: "travel-provider" })).toBeUndefined();
  expect(renderStayDetails({ ...old, providerItemId: "plan-42" })).toBeUndefined();
});


it("updates saved Rakuten link dates to the stay dates after editing", () => {
  const value = stay();
  const updated = { ...value, observedDetails: { observedAt: at, sourceUrl: "https://hotel.travel.rakuten.co.jp/hinfo/42/?f_nen1=2025&f_otona_su=2" } };
  const link = renderStayDetails(updated)!.querySelector<HTMLAnchorElement>("a")!;
  const url = new URL(link.href);
  expect(url.pathname).toBe("/hotelinfo/plan/42");
  expect(url.searchParams.get("f_nen1")).toBe("2026");
  expect(url.searchParams.get("f_hi1")).toBe("24");
  expect(url.searchParams.get("f_otona_su")).toBe("2");
});
