import { createHash } from "node:crypto";
import type { ResearchExecutionOutcome } from "@raiquora/agent/research-execution";
import type { TrustedPrincipal } from "./trusted-principal.js";
import { stateId } from "./server-state.js";

export interface ResearchContinuationScope {
  principal: TrustedPrincipal;
  conversationId: string;
  sourceTurnId: string;
  tripId?: string;
  tripRevision?: number;
  researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number };
}

/** Private owner-scoped receipt. This, not the public random ref, is the authorization object. */
export interface ResearchContinuationReceipt {
  readonly storageVersion: 1;
  readonly ref: string;
  readonly kind: "receipt-result" | "new-turn-request";
  readonly scopeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly remainingScopes: readonly string[];
}

export function issueResearchContinuation(scope: ResearchContinuationScope, input: {
  kind: ResearchContinuationReceipt["kind"]; ref: string; issuedAt: string; ttlMs: number; remainingScopes: readonly string[];
}): { public: NonNullable<ResearchExecutionOutcome["continuation"]>; receipt: ResearchContinuationReceipt } {
  validateScope(scope);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input.ref) ||
      !validInstant(input.issuedAt) || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 86_400_000 ||
      !validRefs(input.remainingScopes) || !input.remainingScopes.length) throw new Error("Invalid research continuation issue request");
  const expiresAt = new Date(Date.parse(input.issuedAt) + input.ttlMs).toISOString();
  const receipt: ResearchContinuationReceipt = { storageVersion: 1, ref: input.ref, kind: input.kind,
    scopeDigest: scopeDigest(scope), issuedAt: input.issuedAt, expiresAt, remainingScopes: [...input.remainingScopes] };
  return { public: { kind: input.kind, issuedBy: "server", ref: input.ref, expiresAt }, receipt };
}

/** Resolve only after an owner-scoped repository read. Browser input is a locator, never authority. */
export function authorizeResearchContinuation(receipt: ResearchContinuationReceipt, scope: ResearchContinuationScope,
  now: string, expectedKind: ResearchContinuationReceipt["kind"]): ResearchContinuationReceipt {
  validateScope(scope);
  if (receipt.storageVersion !== 1 || receipt.kind !== expectedKind || receipt.scopeDigest !== scopeDigest(scope) ||
      !validInstant(receipt.issuedAt) || !validInstant(receipt.expiresAt) || !validInstant(now) || Date.parse(now) >= Date.parse(receipt.expiresAt) ||
      !validRefs(receipt.remainingScopes) || !receipt.remainingScopes.length) throw new Error("Stale or foreign research continuation");
  return structuredClone(receipt);
}

function scopeDigest(scope: ResearchContinuationScope): string {
  return createHash("sha256").update(JSON.stringify([scope.principal.subject, scope.conversationId, scope.sourceTurnId,
    scope.tripId ?? null, scope.tripRevision ?? null, scope.researchTarget?.presentationId ?? null,
    scope.researchTarget?.candidateSetId ?? null, scope.researchTarget?.candidateSetRevision ?? null])).digest("hex");
}
function validateScope(scope: ResearchContinuationScope): void {
  if (!/^identity-v1:[0-9a-f]{64}$/u.test(scope.principal.subject)) throw new Error("Invalid research continuation scope");
  stateId(scope.conversationId); stateId(scope.sourceTurnId);
  if (scope.tripId !== undefined) stateId(scope.tripId);
  if (scope.tripRevision !== undefined && (!Number.isSafeInteger(scope.tripRevision) || scope.tripRevision < 0)) throw new Error("Invalid research continuation scope");
  if (scope.researchTarget && (!ref(scope.researchTarget.presentationId) || scope.researchTarget.candidateSetId !== undefined && !ref(scope.researchTarget.candidateSetId) ||
      scope.researchTarget.candidateSetRevision !== undefined && (!Number.isSafeInteger(scope.researchTarget.candidateSetRevision) || scope.researchTarget.candidateSetRevision < 0))) throw new Error("Invalid research continuation scope");
}
function validRefs(value: readonly string[]): boolean { return Array.isArray(value) && value.length <= 100 && value.every(ref) && new Set(value).size === value.length; }
function ref(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value); }
function validInstant(value: string): boolean { return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
