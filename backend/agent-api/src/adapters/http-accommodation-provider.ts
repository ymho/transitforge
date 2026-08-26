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
    url.searchParams.set("keyword", request.destination);
    url.searchParams.set("hits", String(request.limit));
    if (credentials.affiliateId) url.searchParams.set("affiliateId", credentials.affiliateId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.http.fetch(url.toString(), { headers: { accessKey: credentials.accessKey, Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error("provider response was not successful");
      return providerResults(await response.json(), request.limit).map((result) => createAccommodationOffering("travel-provider", request, result));
    } catch (error) {
      throw new Error("宿泊提供者の検索を利用できません。", { cause: error });
    } finally { clearTimeout(timeout); }
  }
}

function providerResults(value: unknown, limit: number): AccommodationProviderResult[] {
  if (!isRecord(value)) throw new Error("宿泊提供者の応答を読み取れません。");
  if (!Array.isArray(value.hotels)) return [];
  return value.hotels.slice(0, limit).flatMap((hotel) => {
    const basic = hotelBasicInfo(hotel);
    if (!basic || !Number.isInteger(basic.hotelNo) || typeof basic.hotelName !== "string" || !basic.hotelName.trim()) return [];
    return [{ providerItemId: String(basic.hotelNo), name: basic.hotelName,
      ...stringField("bookingUrl", basic.hotelInformationUrl), ...stringField("areaName", basic.address1),
      ...stringField("imageUrl", basic.hotelImageUrl) }];
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
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
