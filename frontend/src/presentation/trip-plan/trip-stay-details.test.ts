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
  root.querySelector("img")!.dispatchEvent(new Event("error")); expect(root.querySelector("img")).toBeNull();
});
it("links legacy Rakuten stays by verified facility ID without inventing pictures, ratings or prices", () => {
  const old = stay(); delete (old as { observedDetails?: unknown }).observedDetails; delete (old as { observedPrice?: unknown }).observedPrice;
  const root = renderStayDetails(old)!;
  expect(root.querySelector<HTMLAnchorElement>("a")?.href).toBe("https://travel.rakuten.co.jp/HOTEL/42/42.html");
  expect(root.querySelector("img, dl")).toBeNull();
  expect(renderStayDetails({ ...old, provider: "travel-provider" })).toBeUndefined();
  expect(renderStayDetails({ ...old, providerItemId: "plan-42" })).toBeUndefined();
});
