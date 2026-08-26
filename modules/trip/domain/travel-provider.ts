import type { AccommodationOffering } from "./travel-candidate.js";

export interface TravelProviderSearch {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  limit: number;
}

export interface AccommodationProviderResult {
  providerItemId: string;
  name: string;
  bookingUrl?: string;
  areaName?: string;
  imageUrl?: string;
}

export function createAccommodationOffering(
  provider: string,
  request: TravelProviderSearch,
  result: AccommodationProviderResult,
): AccommodationOffering {
  if (!provider.trim() || !result.providerItemId.trim() || !result.name.trim()) {
    throw new Error("宿泊候補の識別子と名称が必要です。");
  }
  return {
    kind: "accommodation",
    provider: provider.trim(),
    providerItemId: result.providerItemId.trim(),
    name: result.name.trim(),
    checkInDate: request.checkInDate,
    checkOutDate: request.checkOutDate,
    ...optional("bookingUrl", result.bookingUrl),
    ...optional("areaName", result.areaName),
    ...optionalHttpsUrl("imageUrl", result.imageUrl),
  };
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } as Record<K, string> : {};
}

function optionalHttpsUrl<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  if (typeof value !== "string") return {};
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? { [key]: url.toString() } as Record<K, string> : {};
  } catch {
    return {};
  }
}
