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
  address?: string;
  latitude?: number;
  longitude?: number;
  reviewAverage?: number;
  reviewCount?: number;
  minimumCharge?: number;
  availability?: "available" | "unknown";
  priceBasis?: "reference-minimum" | "selected-dates";
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
    ...optional("address", result.address),
    ...coordinate("latitude", result.latitude, -90, 90),
    ...coordinate("longitude", result.longitude, -180, 180),
    ...boundedNumber("reviewAverage", result.reviewAverage, 0, 5),
    ...boundedInteger("reviewCount", result.reviewCount, 0),
    ...(Number.isSafeInteger(result.minimumCharge) && result.minimumCharge! >= 0
      ? {
          price: { amount: result.minimumCharge!, currency: "JPY" as const },
          priceBasis: result.priceBasis ?? (result.availability === "available" ? "selected-dates" as const : "reference-minimum" as const),
        }
      : {}),
    availability: result.availability ?? "unknown",
  };
}

function coordinate<K extends "latitude" | "longitude">(
  key: K,
  value: number | undefined,
  minimum: number,
  maximum: number,
): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? { [key]: value } as Record<K, number>
    : {};
}

function boundedNumber<K extends string>(
  key: K,
  value: number | undefined,
  minimum: number,
  maximum: number,
): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? { [key]: value } as Record<K, number>
    : {};
}

function boundedInteger<K extends string>(
  key: K,
  value: number | undefined,
  minimum: number,
): Partial<Record<K, number>> {
  return Number.isSafeInteger(value) && value! >= minimum
    ? { [key]: value! } as Record<K, number>
    : {};
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
