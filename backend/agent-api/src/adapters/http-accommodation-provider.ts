import { createAccommodationOffering, type AccommodationProviderResult, type TravelProviderSearch } from "@raiquora/trip/travel-provider";
import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { AccommodationProvider, TravelProviderCredentialsRepository } from "../ports/travel-provider.js";

export interface HttpClient {
  fetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

export class HttpAccommodationProvider implements AccommodationProvider {
  constructor(private readonly http: HttpClient, private readonly credentials: TravelProviderCredentialsRepository) {}

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
      const discovered = providerResults(await response.json(), request.limit);
      const available = credentials.vacantHotelSearchUrl
        ? await this.confirmAvailability(credentials, request, discovered)
        : undefined;
      return (available ?? discovered).map((result) => createAccommodationOffering("travel-provider", request, result));
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
      return providerResults(await response.json(), request.limit, true);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function providerResults(value: unknown, limit: number, availabilityConfirmed = false): AccommodationProviderResult[] {
  if (!isRecord(value)) throw new Error("宿泊提供者の応答を読み取れません。");
  if (!Array.isArray(value.hotels)) return [];
  return value.hotels.slice(0, limit).flatMap((hotel) => {
    const basic = hotelBasicInfo(hotel);
    if (!basic || !Number.isInteger(basic.hotelNo) || typeof basic.hotelName !== "string" || !basic.hotelName.trim()) return [];
    const address = [basic.address1, basic.address2]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("");
    return [{ providerItemId: String(basic.hotelNo), name: basic.hotelName,
      ...stringField("bookingUrl", basic.hotelInformationUrl), ...stringField("areaName", basic.address1),
      ...stringField("imageUrl", basic.hotelImageUrl), ...stringField("address", address),
      ...numberField("latitude", basic.latitude), ...numberField("longitude", basic.longitude),
      ...numberField("reviewAverage", basic.reviewAverage), ...integerField("reviewCount", basic.reviewCount),
      ...integerField("minimumCharge", basic.hotelMinCharge),
      availability: availabilityConfirmed ? "available" as const : "unknown" as const }];
  });
}
function hotelBasicInfo(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return value.map(hotelBasicInfo).find((item) => item !== undefined);
  if (!isRecord(value)) return undefined;
  return isRecord(value.hotelBasicInfo) ? value.hotelBasicInfo : undefined;
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
