import { describe, expect, it } from "vitest";
import { authorizeResearchContinuation, issueResearchContinuation } from "./research-continuation.js";
import type { TrustedPrincipal } from "./trusted-principal.js";

const principal = (suffix: string): TrustedPrincipal => ({ subject: `identity-v1:${suffix.repeat(64)}`,
  identity: { issuer: "https://issuer.test", subject: suffix }, scopes: ["raiquora/user"] });
const scope = { principal: principal("a"), conversationId: "11111111-1111-4111-8111-111111111111",
  sourceTurnId: "22222222-2222-4222-8222-222222222222", tripId: "33333333-3333-4333-8333-333333333333", tripRevision: 7,
  researchTarget: { presentationId: "presentation-1", candidateSetId: "set-1", candidateSetRevision: 2 } };

describe("research continuation authority", () => {
  it("binds an opaque locator to owner, conversation, turn, Trip revision and research target", () => {
    const issued = issueResearchContinuation(scope, { kind: "receipt-result", ref: "44444444-4444-4444-8444-444444444444",
      issuedAt: "2026-09-23T12:00:00.000Z", ttlMs: 60_000, remainingScopes: ["day:31"] });
    expect(issued.public).toEqual({ kind: "receipt-result", issuedBy: "server", ref: "44444444-4444-4444-8444-444444444444", expiresAt: "2026-09-23T12:01:00.000Z" });
    expect(authorizeResearchContinuation(issued.receipt, scope, "2026-09-23T12:00:30.000Z", "receipt-result")).toEqual(issued.receipt);
    for (const changed of [{ ...scope, principal: principal("b") }, { ...scope, tripRevision: 8 },
      { ...scope, researchTarget: { ...scope.researchTarget, candidateSetRevision: 3 } }]) {
      expect(() => authorizeResearchContinuation(issued.receipt, changed, "2026-09-23T12:00:30.000Z", "receipt-result")).toThrow();
    }
  });

  it("separates receipt readback from a new-turn request and rejects expiry", () => {
    const issued = issueResearchContinuation(scope, { kind: "new-turn-request", ref: "55555555-5555-4555-8555-555555555555",
      issuedAt: "2026-09-23T12:00:00.000Z", ttlMs: 1_000, remainingScopes: ["evidence:opening-hours"] });
    expect(() => authorizeResearchContinuation(issued.receipt, scope, "2026-09-23T12:00:00.500Z", "receipt-result")).toThrow();
    expect(() => authorizeResearchContinuation(issued.receipt, scope, "2026-09-23T12:00:01.000Z", "new-turn-request")).toThrow();
  });
});
