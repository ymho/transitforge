/** Read-back of an Application commit. No mutation authority or model text. */
export interface PublicTripMutationReceipt {
  version: "public-trip-mutation-receipt-v1";
  tripId: string;
  tripRevision: number;
}
export function parsePublicTripMutationReceipt(value: unknown): PublicTripMutationReceipt {
  const v = value as PublicTripMutationReceipt;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(key => !["version", "tripId", "tripRevision"].includes(key)) ||
      v.version !== "public-trip-mutation-receipt-v1" || typeof v.tripId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v.tripId) ||
      !Number.isSafeInteger(v.tripRevision) || v.tripRevision < 1) throw new Error("Invalid public Trip mutation receipt");
  return structuredClone(v);
}
