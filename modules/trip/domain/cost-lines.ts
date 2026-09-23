import { addMoney, validateMoney, type Money } from "./money";
import { exactKeys } from "./snapshot-validation";

export const costLineKinds = ["forecast", "provider_observed", "user_override", "reservation_price", "paid_price"] as const;
export type CostLineKind = typeof costLineKinds[number];
export const costLineDimensions = ["person", "room", "night", "leg", "unit"] as const;
export type CostLineDimension = typeof costLineDimensions[number];
export interface CostLineBasis {
  /** Pass/shared describe the economic resource; dimensions remain composable (for example room × night). */
  readonly scope: "whole-trip" | "pass" | "shared-resource";
  readonly dimensions: readonly CostLineDimension[];
}
export interface CostQuantity { readonly dimension: CostLineDimension; readonly count?: number; readonly unknownReason?: string }
export type CostCoverage = "complete" | "partial" | "unknown";

export interface CostTargetRefs {
  readonly itemIds?: readonly string[];
  readonly logicalDayIds?: readonly string[];
  readonly segmentIds?: readonly string[];
  readonly participantIds?: readonly string[];
  readonly resourceIds?: readonly string[];
}

/** One economic charge. References may appear on many days, but the line is summed once. */
export interface CostLine {
  readonly id: string;
  readonly category: "transport" | "accommodation" | "sightseeing" | "food" | "other";
  readonly kind: CostLineKind;
  readonly basis: CostLineBasis;
  readonly amount?: Money;
  readonly amountRole: "total" | "unit";
  readonly quantities: readonly CostQuantity[];
  readonly targetRefs: CostTargetRefs;
  readonly coverage: CostCoverage;
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly assumptions: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly inputFingerprint: string;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly supersedesLineIds?: readonly string[];
}

export interface CostLineSummary {
  readonly totals: readonly Money[];
  readonly lineTotals: readonly { costLineId: string; amount?: Money; status: "included" | "unknown" | "stale" }[];
  readonly unknownLineIds: readonly string[];
  readonly staleLineIds: readonly string[];
  readonly currencies: readonly string[];
  readonly coverage: "complete" | "partial" | "unknown";
}

export interface CostAllocation {
  readonly costLineId: string;
  readonly targetRef: string;
  readonly amount: Money;
  readonly derived: true;
}

export function validateCostLine(line: CostLine): void {
  exactKeys(line, ["id", "category", "kind", "basis", "amount", "amountRole", "quantities", "targetRefs", "coverage", "included", "excluded", "assumptions", "evidenceRefs", "inputFingerprint", "observedAt", "validUntil", "supersedesLineIds"]);
  exactKeys(line.basis, ["scope", "dimensions"]);
  exactKeys(line.targetRefs, ["itemIds", "logicalDayIds", "segmentIds", "participantIds", "resourceIds"]);
  stableId(line.id);
  if (!["transport", "accommodation", "sightseeing", "food", "other"].includes(line.category) ||
      !costLineKinds.includes(line.kind) || !["whole-trip", "pass", "shared-resource"].includes(line.basis.scope) ||
      !Array.isArray(line.basis.dimensions) || new Set(line.basis.dimensions).size !== line.basis.dimensions.length ||
      line.basis.dimensions.some((dimension) => !costLineDimensions.includes(dimension)) ||
      !["total", "unit"].includes(line.amountRole) || !["complete", "partial", "unknown"].includes(line.coverage) ||
      !line.inputFingerprint || line.inputFingerprint.length > 160) throw new Error("Invalid cost line");
  if (line.amount !== undefined) validateMoney(line.amount);
  if (!Array.isArray(line.quantities) || new Set(line.quantities.map(({ dimension }) => dimension)).size !== line.quantities.length ||
      line.quantities.some(({ dimension, count, unknownReason }) => !costLineDimensions.includes(dimension) || !line.basis.dimensions.includes(dimension) ||
        count !== undefined && (!Number.isSafeInteger(count) || count <= 0) || count === undefined && !unknownReason?.trim())) throw new Error("Invalid cost quantity");
  line.quantities.forEach((quantity) => exactKeys(quantity, ["dimension", "count", "unknownReason"]));
  if (line.amountRole === "unit" && line.amount !== undefined && (line.basis.dimensions.length === 0 || line.basis.dimensions.some((dimension) => !line.quantities.some((quantity) => quantity.dimension === dimension)) ||
      line.coverage === "complete" && line.basis.dimensions.some((dimension) => !line.quantities.some((quantity) => quantity.dimension === dimension && quantity.count !== undefined)))) throw new Error("Unit cost requires every dimension quantity");
  if (line.amountRole === "total" && line.quantities.length) throw new Error("Total cost cannot also multiply quantities");
  if (line.coverage === "complete" && line.amount === undefined) throw new Error("Complete cost requires amount");
  for (const refs of Object.values(line.targetRefs)) validateRefs(refs);
  validateTexts(line.included, 24); validateTexts(line.excluded, 24); validateTexts(line.assumptions, 16);
  if (line.evidenceRefs !== undefined) validateRefs(line.evidenceRefs);
  if (line.supersedesLineIds !== undefined) validateRefs(line.supersedesLineIds);
  if (line.supersedesLineIds?.includes(line.id)) throw new Error("Cost line cannot supersede itself");
  if (line.kind === "provider_observed" && !line.evidenceRefs?.length) throw new Error("Observed cost requires evidence");
  if ((line.kind === "provider_observed" || line.kind === "reservation_price" || line.kind === "paid_price") && !validInstant(line.observedAt)) {
    throw new Error("Observed cost requires timestamp");
  }
  if (line.validUntil !== undefined && (!validInstant(line.validUntil) || line.observedAt !== undefined && Date.parse(line.validUntil) < Date.parse(line.observedAt))) {
    throw new Error("Invalid cost validity");
  }
}

/** Conflicting duplicate IDs are rejected; exact duplicate references are summed once. */
export function summarizeCostLines(lines: readonly CostLine[], evaluatedAt: string): CostLineSummary {
  if (!validInstant(evaluatedAt)) throw new Error("Invalid evaluation time");
  const unique = uniqueLines(lines);
  const superseded = new Set(unique.flatMap((line) => line.supersedesLineIds ?? []));
  const totals = new Map<string, Money>();
  const lineTotals: CostLineSummary["lineTotals"][number][] = [];
  const unknownLineIds: string[] = [], staleLineIds: string[] = [];
  for (const line of unique) {
    if (superseded.has(line.id)) continue;
    const stale = line.validUntil !== undefined && Date.parse(line.validUntil) < Date.parse(evaluatedAt);
    const amount = effectiveAmount(line);
    if (stale) { staleLineIds.push(line.id); lineTotals.push({ costLineId: line.id, amount, status: "stale" }); continue; }
    if (!amount || line.coverage !== "complete") { unknownLineIds.push(line.id); lineTotals.push({ costLineId: line.id, amount, status: "unknown" }); continue; }
    totals.set(amount.currency, addMoney(totals.get(amount.currency) ?? { currency: amount.currency, amountMinor: 0 }, amount));
    lineTotals.push({ costLineId: line.id, amount, status: "included" });
  }
  const currencies = [...totals.keys()].sort();
  return { totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), lineTotals,
    unknownLineIds, staleLineIds, currencies, coverage: !lineTotals.length || unknownLineIds.length || staleLineIds.length
      ? totals.size ? "partial" : "unknown" : "complete" };
}

/** Largest-remainder allocation preserves the source total exactly. Allocations are display-only. */
export function allocateCostLine(line: CostLine, weights: Readonly<Record<string, number>>): readonly CostAllocation[] {
  validateCostLine(line);
  const amount = effectiveAmount(line);
  const entries = Object.entries(weights).sort(([a], [b]) => a.localeCompare(b));
  if (!amount || line.coverage !== "complete" || !entries.length || entries.some(([key, value]) => !key || !Number.isSafeInteger(value) || value <= 0)) return [];
  const totalWeight = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!Number.isSafeInteger(totalWeight)) throw new Error("Allocation overflow");
  const base = entries.map(([targetRef, weight]) => ({ targetRef, amountMinor: Math.floor(amount.amountMinor * weight / totalWeight), remainder: amount.amountMinor * weight % totalWeight }));
  let remaining = amount.amountMinor - base.reduce((sum, value) => sum + value.amountMinor, 0);
  for (const entry of [...base].sort((a, b) => b.remainder - a.remainder || a.targetRef.localeCompare(b.targetRef))) {
    if (remaining-- <= 0) break;
    entry.amountMinor += 1;
  }
  return base.map(({ targetRef, amountMinor }) => ({ costLineId: line.id, targetRef,
    amount: { currency: amount.currency, amountMinor }, derived: true }));
}

export function costInputFingerprint(value: unknown): string {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `cost-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function effectiveAmount(line: CostLine): Money | undefined {
  if (!line.amount) return undefined;
  if (line.amountRole === "total") return line.amount;
  if (line.quantities.some(({ count }) => count === undefined)) return undefined;
  const multiplier = line.quantities.reduce((value, quantity) => value * quantity.count!, 1);
  if (!Number.isSafeInteger(multiplier)) throw new Error("Cost quantity overflow");
  const amountMinor = line.amount.amountMinor * multiplier;
  if (!Number.isSafeInteger(amountMinor)) throw new Error("Cost total overflow");
  const result = { currency: line.amount.currency, amountMinor }; validateMoney(result); return result;
}
function uniqueLines(lines: readonly CostLine[]): CostLine[] {
  const result = new Map<string, CostLine>();
  for (const line of lines) {
    validateCostLine(line);
    const previous = result.get(line.id);
    if (previous && stableJson(previous) !== stableJson(line)) throw new Error("Conflicting duplicate cost line");
    result.set(line.id, line);
  }
  const values = [...result.values()];
  const ids = new Set(result.keys());
  if (values.some((line) => line.supersedesLineIds?.some((id) => !ids.has(id)))) throw new Error("Unknown superseded cost line");
  const visiting = new Set<string>(), visited = new Set<string>();
  const walk = (id: string) => { if (visiting.has(id)) throw new Error("Cost supersession cycle"); if (visited.has(id)) return; visiting.add(id);
    result.get(id)?.supersedesLineIds?.forEach(walk); visiting.delete(id); visited.add(id); };
  values.forEach(({ id }) => walk(id));
  return values;
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function stableId(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value)) throw new Error("Invalid stable ID"); }
function validateRefs(value: unknown): void { if (!Array.isArray(value) || new Set(value).size !== value.length) throw new Error("Invalid references"); value.forEach(stableId); }
function validateTexts(value: unknown, maximum: number): void { if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 240)) throw new Error("Invalid cost notes"); }
function validInstant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)); }
