import { validatePlaceRef, validatePlaceSource } from "@raiquora/trip/place-snapshot";
import { validateWatchSubject } from "@raiquora/trip/trip-watch";
import type { HazardTargetBinding, RecheckTargetCatalog } from "../ports/recheck-targets.js";
import type { S3JourneyClient } from "./s3-journey-data.js";

/** Private, separately provisioned catalog. Missing file is unresolved, NOT a name-heuristic fallback. */
export class S3RecheckTargetCatalog implements RecheckTargetCatalog {
  private cached?: Promise<readonly HazardTargetBinding[]>;
  constructor(private readonly s3: S3JourneyClient, private readonly bucket: string, private readonly key: string) {}
  read(): Promise<readonly HazardTargetBinding[]> {
    return this.cached ??= this.load(); // instance lifetime is one bounded poll
  }
  private async load(): Promise<readonly HazardTargetBinding[]> {
    const { Body } = await this.s3.getObject({ Bucket: this.bucket, Key: this.key });
    if (!Body || Body.byteLength > 512 * 1024) throw new Error("invalid-target-catalog");
    return parseRecheckTargetCatalog(JSON.parse(new TextDecoder().decode(Body)));
  }
}
export function parseRecheckTargetCatalog(value: unknown): HazardTargetBinding[] {
  const v = value as { schemaVersion: number; bindings: HazardTargetBinding[] };
  if (!v || v.schemaVersion !== 1 || Object.keys(v).some((key) => !["schemaVersion", "bindings"].includes(key)) ||
      !Array.isArray(v.bindings) || v.bindings.length > 1000) throw new Error("invalid-target-catalog");
  for (const binding of v.bindings) {
    if (Object.keys(binding).some((key) => !["ref", "area", "sources"].includes(key))) throw new Error("invalid-target-binding");
    validatePlaceRef(binding.ref); validateWatchSubject({ type: "hazard-area", area: binding.area });
    if (binding.ref.provider === "manual" || !Array.isArray(binding.sources) || !binding.sources.length) throw new Error("unverified-target-binding");
    binding.sources.forEach((source) => { validatePlaceSource(source); if (source.confidence === "unknown") throw new Error("unverified-target-binding"); });
  }
  return structuredClone(v.bindings); // Duplicate identity is deliberately ambiguous at resolution, not first-wins.
}
