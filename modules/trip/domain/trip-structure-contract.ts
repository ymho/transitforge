import { exactKeys } from "./snapshot-validation";

export type TripRelationKind = "requires-movement" | "return-to-base" | "baggage-drop-pickup" | "vehicle-pickup-return";
export interface AuthoredTripRelation {
  readonly relationId: string;
  readonly beforeItemRef: string;
  readonly afterItemRef: string;
  readonly kind: TripRelationKind;
  readonly status: "authored" | "assumed";
  readonly evidenceRefs?: readonly string[];
}
export interface AuthoredStaySegment {
  readonly segmentId: string;
  readonly label?: string;
  readonly anchorItemIds: readonly string[];
  readonly logicalDayIds?: readonly string[];
}
export interface TripStructureIntent {
  readonly version: 1;
  readonly authoredSegments: readonly AuthoredStaySegment[];
  readonly relations: readonly AuthoredTripRelation[];
}

export function validateTripStructureIntent(value: TripStructureIntent, itemIds: ReadonlySet<string>, logicalDayIds: ReadonlySet<string>): void {
  exactKeys(value, ["version", "authoredSegments", "relations"]);
  if (value.version !== 1 || !Array.isArray(value.authoredSegments) || !Array.isArray(value.relations)) throw new Error("Invalid Trip structure intent");
  const ids = new Set<string>();
  for (const segment of value.authoredSegments) {
    exactKeys(segment, ["segmentId", "label", "anchorItemIds", "logicalDayIds"]); stableId(segment.segmentId);
    if (ids.has(segment.segmentId)) throw new Error("Duplicate authored segment"); ids.add(segment.segmentId);
    if (segment.label !== undefined && (typeof segment.label !== "string" || !segment.label.trim())) throw new Error("Invalid segment label");
    refs(segment.anchorItemIds, itemIds, "segment item");
    if (segment.logicalDayIds !== undefined) refs(segment.logicalDayIds, logicalDayIds, "segment day");
  }
  for (const relation of value.relations) {
    exactKeys(relation, ["relationId", "beforeItemRef", "afterItemRef", "kind", "status", "evidenceRefs"]); stableId(relation.relationId);
    if (ids.has(relation.relationId)) throw new Error("Duplicate structure identity"); ids.add(relation.relationId);
    if (!itemIds.has(relation.beforeItemRef) || !itemIds.has(relation.afterItemRef) || relation.beforeItemRef === relation.afterItemRef ||
      !["requires-movement", "return-to-base", "baggage-drop-pickup", "vehicle-pickup-return"].includes(relation.kind) ||
      !["authored", "assumed"].includes(relation.status)) throw new Error("Invalid Trip relation");
    if (relation.evidenceRefs !== undefined) refs(relation.evidenceRefs, undefined, "evidence");
  }
}
function stableId(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value)) throw new Error("Invalid stable ID"); }
function refs(values: readonly string[], allowed: ReadonlySet<string> | undefined, label: string): void {
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length) throw new Error(`Invalid ${label} references`);
  values.forEach((value) => { stableId(value); if (allowed && !allowed.has(value)) throw new Error(`Missing ${label} reference`); });
}
