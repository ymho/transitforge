import { expect, it } from "vitest";
import { rakutenAccommodationLink } from "./rakuten-accommodation-link";

it("dates nested affiliate destinations while preserving attribution and saved adults", () => {
  const destination = "https://hotel.travel.rakuten.co.jp/hinfo/42/?f_otona_su=2";
  const source = `https://hb.afl.rakuten.co.jp/hgc/fixture/?pc=${encodeURIComponent(destination)}&m=${encodeURIComponent(destination)}&link_type=text`;
  const url = new URL(rakutenAccommodationLink(source, { checkInDate: "2026-12-31", checkOutDate: "2027-01-02" }));
  expect(url.pathname).toBe("/hgc/fixture/");
  expect(url.searchParams.get("link_type")).toBe("text");
  for (const key of ["pc", "m"]) {
    const nested = new URL(url.searchParams.get(key)!);
    expect(nested.pathname).toBe("/hotelinfo/plan/42");
    expect(Object.fromEntries(nested.searchParams)).toMatchObject({ f_nen1: "2026", f_tuki1: "12", f_hi1: "31", f_nen2: "2027", f_tuki2: "1", f_hi2: "2", f_otona_su: "2" });
  }
});
