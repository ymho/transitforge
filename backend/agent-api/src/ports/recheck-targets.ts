import type { PlaceRef } from "@raiquora/trip/place-snapshot";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
/** Operator-controlled, evidence-backed binding. No facility-name matching or provider raw values. */
export interface HazardTargetBinding { readonly ref: PlaceRef; readonly area: string; readonly sources: readonly ExternalSourceEvidence[] }
export interface RecheckTargetCatalog { read(): Promise<readonly HazardTargetBinding[]> }
