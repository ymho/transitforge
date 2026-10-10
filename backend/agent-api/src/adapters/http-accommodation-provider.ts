import { createAccommodationOffering, type AccommodationProviderResult, type TravelProviderSearch } from "@raiquora/trip/travel-provider";
import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { AccommodationProvider, TravelProviderCredentialsRepository } from "../ports/travel-provider.js";

export interface HttpClient {
  fetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

export class HttpAccommodationProvider implements AccommodationProvider {
  constructor(private readonly http: HttpClient, private readonly credentials: TravelProviderCredentialsRepository,
    private readonly now: () => string = () => new Date().toISOString()) {}

  async search(request: TravelProviderSearch): Promise<readonly AccommodationOffering[]> {
    const credentials = await this.credentials.load();
    const url = new URL(credentials.hotelSearchUrl);
    url.searchParams.set("applicationId", credentials.applicationId);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatVersion", "2");
    url.searchParams.set("datumType", "1");
    url.searchParams.set("responseType", "large");
    url.searchParams.set("keyword", request.destination);
    url.searchParams.set("hits", String(request.limit));
    if (credentials.affiliateId) url.searchParams.set("affiliateId", credentials.affiliateId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.http.fetch(url.toString(), { headers: { accessKey: credentials.accessKey, Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error("provider response was not successful");
      const body = await response.json();
      const discovered = providerResults(body, request.limit, this.now());
      const available = credentials.vacantHotelSearchUrl
        ? await this.confirmAvailability(credentials, request, discovered)
        : undefined;
      // Vacancy search may confirm fewer hotels than discovery. Keep the other
      // comparison options with unknown availability instead of dropping them.
      const confirmedIds = new Set(available?.map(result => result.providerItemId) ?? []);
      const confirmed = available?.map(result => ({ ...discovered.find(hotel => hotel.providerItemId === result.providerItemId), ...result }));
      const candidates = confirmed ? [...confirmed, ...discovered.filter(result => !confirmedIds.has(result.providerItemId))].slice(0, request.limit) : discovered;
      // This adapter implements Rakuten Travel's hotel catalog: hotelNo is a
      // facility number, not a room/plan identifier or a name-derived identity.
      return candidates.map((result) => createAccommodationOffering("rakuten-travel", request, {
        ...result,
        ...(result.bookingUrl ? { bookingUrl: datedBookingUrl(result.bookingUrl, request) } : {}),
      }));
    } catch (error) {
      throw new Error("宿泊提供者の検索を利用できません。", { cause: error });
    } finally { clearTimeout(timeout); }
  }

  private async confirmAvailability(
    credentials: Awaited<ReturnType<TravelProviderCredentialsRepository["load"]>>,
    request: TravelProviderSearch,
    discovered: readonly AccommodationProviderResult[],
  ): Promise<AccommodationProviderResult[] | undefined> {
    const hotelNumbers = discovered.map(({ providerItemId }) => providerItemId).slice(0, 15);
    if (!credentials.vacantHotelSearchUrl || hotelNumbers.length === 0) return undefined;
    const url = new URL(credentials.vacantHotelSearchUrl);
    url.searchParams.set("applicationId", credentials.applicationId);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatVersion", "2");
    url.searchParams.set("datumType", "1");
    url.searchParams.set("responseType", "large");
    url.searchParams.set("searchPattern", "0");
    url.searchParams.set("hotelNo", hotelNumbers.join(","));
    url.searchParams.set("checkinDate", request.checkInDate);
    url.searchParams.set("checkoutDate", request.checkOutDate);
    url.searchParams.set("adultNum", String(request.adults));
    url.searchParams.set("hits", String(Math.min(30, request.limit)));
    if (credentials.affiliateId) url.searchParams.set("affiliateId", credentials.affiliateId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.http.fetch(url.toString(), {
        headers: { accessKey: credentials.accessKey, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const body = await response.json();
      return providerResults(body, request.limit, this.now(), true);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function providerResults(value: unknown, limit: number, observedAt: string, availabilityConfirmed = false): AccommodationProviderResult[] {
  if (!isRecord(value)) throw new Error("宿泊提供者の応答を読み取れません。");
  if (!Array.isArray(value.hotels)) return [];
  return value.hotels.slice(0, limit).flatMap((hotel) => {
    const basic = hotelBasicInfo(hotel);
    if (!basic || !Number.isSafeInteger(basic.hotelNo) || (basic.hotelNo as number) <= 0 || typeof basic.hotelName !== "string" || !basic.hotelName.trim()) return [];
    const address = [basic.address1, basic.address2]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("");
    return [{ providerItemId: String(basic.hotelNo), name: basic.hotelName,
      ...stringField("bookingUrl", basic.planListUrl || basic.hotelInformationUrl), ...stringField("areaName", basic.address1),
      ...stringField("description", providerExcerpt(basic.hotelSpecial)),
      ...stringField("reviewExcerpt", providerExcerpt(basic.userReview)),
      ...stringField("imageUrl", basic.hotelImageUrl), ...stringField("address", address),
      ...numberField("latitude", basic.latitude), ...numberField("longitude", basic.longitude),
      ...numberField("reviewAverage", basic.reviewAverage), ...integerField("reviewCount", basic.reviewCount),
      // This endpoint returns integer JPY only. Observation is response receipt, not a provider update time.
      ...(Number.isSafeInteger(basic.hotelMinCharge) && (basic.hotelMinCharge as number) >= 0
        ? { price: { price: { amountMinor: basic.hotelMinCharge as number, currency: "JPY" as const }, observedAt,
          basis: "reference-minimum" as const } } : {}),
      availability: availabilityConfirmed ? "available" as const : "unknown" as const }];
  });
}
function hotelBasicInfo(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return value.map(hotelBasicInfo).find((item) => item !== undefined);
  if (!isRecord(value)) return undefined;
  return isRecord(value.hotelBasicInfo) ? value.hotelBasicInfo : undefined;
}

// Keep provider attribution and affiliate routing while passing the search conditions
// to Rakuten's plan page. Other providers' URLs remain unchanged.
function datedBookingUrl(value: string, request: TravelProviderSearch): string {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.protocol !== "https:" || url.username || url.password) return value;
  if (url.hostname === "hb.afl.rakuten.co.jp") {
    for (const key of ["pc", "m"]) {
      const destination = url.searchParams.get(key);
      if (destination) url.searchParams.set(key, datedBookingUrl(destination, request));
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
  url.searchParams.set("f_otona_su", String(request.adults));
  url.searchParams.set("f_heya_su", "1");
  url.searchParams.set("f_static", "0");
  return url.toString();
}
function stringField<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } as Record<K, string> : {};
}
function numberField<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } as Record<K, number> : {};
}
function integerField<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? { [key]: value } as Record<K, number> : {};
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Extract a short provider-authored introduction without more HTTP/model calls. */
function providerExcerpt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/<[^>]*>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&")
    .replace(/(?:続きを読む|続きはこちら)[\s\S]*$/u, "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= 300) return clean;
  const excerpt = clean.slice(0, 299);
  const sentenceEnd = Math.max(excerpt.lastIndexOf("。"), excerpt.lastIndexOf("！"), excerpt.lastIndexOf("？"));
  return sentenceEnd >= 30 ? excerpt.slice(0, sentenceEnd + 1) : `${excerpt}…`;
}
