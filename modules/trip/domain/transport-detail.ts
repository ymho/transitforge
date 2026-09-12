import type { SelectedRailJourney } from "./selected-rail-journey";
import type { ExternalSourceEvidence } from "./external-travel-information";
import { validatePlaceSnapshot, validatePlaceSource, type PlaceSnapshot } from "./place-snapshot";
import { exactKeys, validInstant } from "./snapshot-validation";

/** Trip V2's mode vocabulary. Legacy MovementMode remains a separate migration input. */
export const transportModes = ["rail", "air", "bus", "ferry", "car", "rental-car", "taxi", "ride-hail", "walk", "bicycle", "other"] as const;
export type TransportMode = typeof transportModes[number];
export type NonRailTransportMode = Exclude<TransportMode, "rail">;
export const nonRailTransportModes = transportModes.filter((mode): mode is NonRailTransportMode => mode !== "rail");
export type TransportProvenance = { readonly type: "manual" } | {
  readonly type: "provider"; readonly provider: string; readonly providerItemId: string;
  readonly selectedAt: string; readonly sources: readonly ExternalSourceEvidence[];
};
export type TransportDetail =
  | { readonly status: "unresolved"; readonly mode?: TransportMode }
  | { readonly status: "selected"; readonly mode: "rail"; readonly journey: SelectedRailJourney }
  | { readonly status: "selected"; readonly mode: NonRailTransportMode;
      readonly origin: PlaceSnapshot; readonly destination: PlaceSnapshot; readonly provenance: TransportProvenance };

/** Schedule is solely the item's top-level value. Selected means adopted, never booked. */
export function validateNonRailTransport(detail: Extract<TransportDetail, { provenance: TransportProvenance }>): void {
  exactKeys(detail, ["status", "mode", "origin", "destination", "provenance"]);
  if (detail.status !== "selected" || !nonRailTransportModes.includes(detail.mode)) throw new Error("Invalid non-rail mode");
  validatePlaceSnapshot(detail.origin); validatePlaceSnapshot(detail.destination);
  const p = detail.provenance;
  if (p.type === "manual") {
    exactKeys(p, ["type"]);
    for (const place of [detail.origin, detail.destination]) {
      if (place.sources.length || place.ref && place.ref.provider !== "manual") throw new Error("Manual transport cannot assert provider facts");
    }
  } else {
    exactKeys(p, ["type", "provider", "providerItemId", "selectedAt", "sources"]);
    if (p.type !== "provider" || typeof p.provider !== "string" || !p.provider.trim() || p.provider === "manual" ||
        typeof p.providerItemId !== "string" || !p.providerItemId.trim() || !validInstant(p.selectedAt) ||
        !Array.isArray(p.sources) || !p.sources.length) throw new Error("Invalid transport provenance");
    for (const source of p.sources) {
      validatePlaceSource(source); // Shared durable source contract, not a parallel Evidence model.
      if (!["timetable", "web"].includes(source.kind) || source.provider !== p.provider || source.sourceId !== p.providerItemId ||
          !["observed", "provider-schedule"].includes(source.confidence) || Date.parse(source.retrievedAt) > Date.parse(p.selectedAt)) {
        throw new Error("Transport source does not establish selected identity");
      }
    }
  }
}
