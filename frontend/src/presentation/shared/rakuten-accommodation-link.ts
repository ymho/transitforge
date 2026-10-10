// Keep provider attribution and affiliate routing while passing the search conditions
// to Rakuten's plan page. Other providers' URLs remain unchanged.
export function rakutenAccommodationLink(value: string, request: { checkInDate: string; checkOutDate: string; adults?: number }, depth = 0): string {
  if (depth > 2 || !/^\d{4}-\d{2}-\d{2}$/u.test(request.checkInDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(request.checkOutDate)) return value;
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.protocol !== "https:" || url.username || url.password) return value;
  if (url.hostname === "hb.afl.rakuten.co.jp") {
    for (const key of ["pc", "m"]) {
      const destination = url.searchParams.get(key);
      if (destination) url.searchParams.set(key, rakutenAccommodationLink(destination, request, depth + 1));
    }
    return url.toString();
  }
  if (!["travel.rakuten.co.jp", "hotel.travel.rakuten.co.jp"].includes(url.hostname)) return value;
  const facility = url.pathname.match(/^\/HOTEL\/(\d+)\/\1\.html$/u) ?? url.pathname.match(/^\/hinfo\/(\d+)\/?$/u);
  if (facility) { url.hostname = "hotel.travel.rakuten.co.jp"; url.pathname = `/hotelinfo/plan/${facility[1]}`; }
  for (const [suffix, date] of [["1", request.checkInDate], ["2", request.checkOutDate]] as const) {
    const [year, month, day] = date.split("-");
    url.searchParams.set(`f_nen${suffix}`, year!);
    url.searchParams.set(`f_tuki${suffix}`, String(Number(month)));
    url.searchParams.set(`f_hi${suffix}`, String(Number(day)));
  }
  if (request.adults !== undefined) url.searchParams.set("f_otona_su", String(request.adults));
  url.searchParams.set("f_heya_su", "1");
  url.searchParams.set("f_static", "0");
  return url.toString();
}
