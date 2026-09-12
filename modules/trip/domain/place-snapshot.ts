import type { ExternalSourceEvidence } from "./external-travel-information";
import { exactKeys, validInstant } from "./snapshot-validation";

/** Opaque identifiers in a provider namespace. Neither names nor coordinates generate identity. */
export interface PlaceRef {
  readonly provider: string;
  readonly providerPlaceId?: string;
  readonly canonicalKey?: string;
}

/** Retainable facts at capture time, not live POI details or a provider response. */
export interface PlaceSnapshot {
  readonly ref?: PlaceRef;
  readonly name: string;
  readonly address?: string;
  readonly coordinate?: { readonly longitude: number; readonly latitude: number };
  readonly area?: string;
  readonly timeZone?: string;
  readonly capturedAt?: string;
  readonly sources: readonly ExternalSourceEvidence[];
}

const placeFields = ["ref", "name", "address", "coordinate", "area", "timeZone", "capturedAt", "sources"] as const;
/** Trusted Adapter assessment passed by Application, never a UI/LLM permission claim or persisted field. */
export type PlaceSnapshotRetention =
  | { readonly origin: "manual" }
  | { readonly origin: "provider"; readonly provider: string;
      readonly storage: "permitted" | "temporary" | "unknown";
      readonly allowedFields: readonly (typeof placeFields[number])[] };

export function validatePlaceRef(ref: PlaceRef): void {
  exactKeys(ref, ["provider", "providerPlaceId", "canonicalKey"]);
  if (!nonempty(ref.provider) ||
      (ref.providerPlaceId !== undefined && !nonempty(ref.providerPlaceId)) ||
      (ref.canonicalKey !== undefined && !nonempty(ref.canonicalKey)) ||
      (ref.provider === "manual" && (ref.providerPlaceId !== undefined || ref.canonicalKey !== undefined))) {
    throw new Error("Invalid place identity");
  }
}

/** Equality of resolved identifiers only, NOT a search matcher or dedup algorithm (#377). */
export function samePlaceIdentity(left: PlaceRef | undefined, right: PlaceRef | undefined): boolean {
  if (!left || !right) return false;
  validatePlaceRef(left); validatePlaceRef(right);
  if (left.provider !== right.provider || left.provider === "manual") return false;
  if (left.providerPlaceId !== undefined && right.providerPlaceId !== undefined) return left.providerPlaceId === right.providerPlaceId;
  return left.canonicalKey !== undefined && left.canonicalKey === right.canonicalKey;
}

export function validatePlaceCoordinate(value: PlaceSnapshot["coordinate"]): void {
  if (!value) throw new Error("Missing place coordinate");
  exactKeys(value, ["longitude", "latitude"]);
  if (!Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
      !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90) throw new Error("Invalid place coordinate");
}

/** Structural validation does not grant retention rights or prove a manual place verified. */
export function validatePlaceSnapshot(place: PlaceSnapshot): void {
  exactKeys(place, placeFields);
  if (!nonempty(place.name) || !Array.isArray(place.sources)) throw new Error("Invalid place snapshot");
  if (place.ref !== undefined) validatePlaceRef(place.ref);
  for (const value of [place.address, place.area]) if (value !== undefined && !nonempty(value)) throw new Error("Invalid place display field");
  if (place.coordinate !== undefined) validatePlaceCoordinate(place.coordinate);
  if (place.timeZone !== undefined) {
    if (!nonempty(place.timeZone)) throw new Error("Invalid place time zone");
    new Intl.DateTimeFormat("en", { timeZone: place.timeZone });
  }
  if (place.capturedAt !== undefined && !validInstant(place.capturedAt)) throw new Error("Invalid place capture time");
  place.sources.forEach((source) => {
    validatePlaceSource(source);
    if (place.capturedAt !== undefined && Date.parse(source.retrievedAt) > Date.parse(place.capturedAt)) throw new Error("Place source is newer than capture");
  });
  if (place.ref?.provider === "manual" && place.sources.length) throw new Error("Provider data cannot be relabeled manual");
  if (place.ref && place.ref.provider !== "manual" && !place.sources.some((source) => source.provider === place.ref!.provider)) {
    throw new Error("Provider place requires durable source provenance");
  }
}

/** Explicit allowlist construction. Unknown runtime fields cannot be copied into the Trip. */
export function createPlaceSnapshot(input: PlaceSnapshot, retention: PlaceSnapshotRetention): PlaceSnapshot {
  if (retention.origin === "manual") {
    if (input.sources.length || (input.ref && input.ref.provider !== "manual")) throw new Error("Provider data cannot be relabeled manual");
  } else if (retention.origin !== "provider" || !nonempty(retention.provider) || retention.provider === "manual" ||
      retention.storage !== "permitted" || retention.allowedFields.some((field) => !placeFields.includes(field)) ||
      !retention.allowedFields.includes("name") || !retention.allowedFields.includes("sources") ||
      (input.ref && input.ref.provider !== retention.provider) ||
      !input.sources.length || input.sources.some((source) => source.provider !== retention.provider)) {
    throw new Error("Place storage permission or source binding is missing");
  }
  const allowed = (field: typeof placeFields[number]): boolean => retention.origin === "manual" || retention.allowedFields.includes(field);
  const place: PlaceSnapshot = {
    name: input.name,
    ...(allowed("ref") && input.ref !== undefined ? { ref: {
      provider: input.ref.provider,
      ...(input.ref.providerPlaceId !== undefined ? { providerPlaceId: input.ref.providerPlaceId } : {}),
      ...(input.ref.canonicalKey !== undefined ? { canonicalKey: input.ref.canonicalKey } : {}),
    } } : {}),
    ...(allowed("address") && input.address !== undefined ? { address: input.address } : {}),
    ...(allowed("coordinate") && input.coordinate !== undefined ? { coordinate: { longitude: input.coordinate.longitude, latitude: input.coordinate.latitude } } : {}),
    ...(allowed("area") && input.area !== undefined ? { area: input.area } : {}),
    ...(allowed("timeZone") && input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
    ...(allowed("capturedAt") && input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    sources: input.sources.map(copyPlaceSource),
  };
  validatePlaceSnapshot(place);
  return place;
}

const sourceFields = ["id", "kind", "provider", "sourceId", "sourceUrl", "retrievedAt", "observedAt", "validFrom", "validUntil", "attribution", "confidence"] as const;
function validatePlaceSource(source: ExternalSourceEvidence): void {
  exactKeys(source, sourceFields);
  if (!nonempty(source.id) || !nonempty(source.provider) || source.provider === "manual" ||
      !["place", "timetable", "accommodation", "restaurant", "web"].includes(source.kind) ||
      !["observed", "provider-schedule", "unknown"].includes(source.confidence) ||
      !validInstant(source.retrievedAt) || (!nonempty(source.sourceId) && !nonempty(source.sourceUrl))) throw new Error("Invalid durable place source");
  if (source.sourceId !== undefined && !nonempty(source.sourceId)) throw new Error("Invalid place source identity");
  if (source.sourceUrl !== undefined) {
    // Persistent citations are public URLs, not token-bearing provider request URLs.
    const url = new URL(source.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Unsafe persistent source URL");
  }
  if (source.attribution !== undefined && !nonempty(source.attribution)) throw new Error("Invalid source attribution");
  for (const at of [source.observedAt, source.validFrom, source.validUntil]) if (at !== undefined && !validInstant(at)) throw new Error("Invalid source timestamp");
}

function copyPlaceSource(source: ExternalSourceEvidence): ExternalSourceEvidence {
  return {
    id: source.id, kind: source.kind, provider: source.provider, retrievedAt: source.retrievedAt, confidence: source.confidence,
    ...(source.sourceId !== undefined ? { sourceId: source.sourceId } : {}),
    ...(source.sourceUrl !== undefined ? { sourceUrl: source.sourceUrl } : {}),
    ...(source.observedAt !== undefined ? { observedAt: source.observedAt } : {}),
    ...(source.validFrom !== undefined ? { validFrom: source.validFrom } : {}),
    ...(source.validUntil !== undefined ? { validUntil: source.validUntil } : {}),
    ...(source.attribution !== undefined ? { attribution: source.attribution } : {}),
  };
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
