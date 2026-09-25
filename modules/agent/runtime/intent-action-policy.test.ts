import { describe, expect, it } from "vitest";
import { compileEffectiveIntent } from "./effective-intent";
import { evidenceForCurrentIntent, validateToolIntentUse } from "./intent-action-policy";
import type { AgentToolDescriptor } from "./tool-contract";
import type { ConversationIntentFact } from "@raiquora/trip/conversation-intent";
import type { Evidence } from "./evidence-model";

const descriptor: AgentToolDescriptor = {
  name: "lookup",
  description: "fixture",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  intentPolicy: { dependencies: ["destination", "start_date"], requirements: [
    { target: "destination", inputField: "location", necessity: "required", match: "exact" },
    { target: "start_date", inputField: "date", necessity: "required", match: "exact", acceptedPrecisions: ["exact"] },
  ] },
};

describe("intent action policy", () => {
  it("allows inputs matching Application-verified user facts", () => {
    const effective = intent([place("京都"), date("2026-10-01")]);
    expect(validateToolIntentUse(descriptor, { location: "京都", date: "2026-10-01" }, effective))
      .toMatchObject({ accepted: true, dependencyTargets: ["destination", "start_date"] });
  });

  it("rejects stale and missing values as a paired negative contract", () => {
    const effective = intent([place("京都"), date("2026-10-01")]);
    expect(validateToolIntentUse(descriptor, { location: "大阪", date: "2026-10-01" }, effective).error?.code)
      .toBe("stale_revision");
    expect(validateToolIntentUse(descriptor, { location: "京都" }, effective).error?.code)
      .toBe("precondition_missing");
  });

  it("invalidates only evidence depending on the changed target and drops untracked legacy evidence", () => {
    const effective = intent([place("京都"), date("2026-10-01")]);
    const tracked = (id: string, targets: ("destination" | "start_date")[]): Evidence => ({ ...evidence(id),
      intentDependency: { intentRevision: effective.intentRevision, fingerprint: effective.fingerprint, targets } });
    expect(evidenceForCurrentIntent([
      tracked("destination", ["destination"]), tracked("date", ["start_date"]), evidence("legacy"),
    ], effective, ["destination"]).map(({ id }) => id)).toEqual(["date"]);
    expect(evidenceForCurrentIntent([tracked("destination", ["destination"])], effective, [])).toHaveLength(1);
  });
});

function intent(facts: ConversationIntentFact[]) {
  return compileEffectiveIntent({ overlay: { version: 1, intentRevision: 2, facts, tombstones: [], appliedMutationIds: [] } });
}

function place(label: string): ConversationIntentFact { return fact("destination", { kind: "place_label", label }, "exact"); }
function date(value: string): ConversationIntentFact { return fact("start_date", { kind: "local_date", date: value }, "exact"); }
function fact(target: "destination" | "start_date", value: ConversationIntentFact["value"], precision: "exact"): ConversationIntentFact {
  return { factId: `fact-${target}`, target, scope: { type: "conversation" }, modality: "required", precision, value,
    frame: "actual", sourceOperationId: `op-${target}`, provenance: { kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: "明示値" } };
}
function evidence(id: string): Evidence { return { id, category: "external", knowledgeKind: "deterministic_fact", subject: id,
  facts: { value: id }, references: [{ sourceType: "external-source", sourceRef: `source:${id}`, retrievedAt: "2026-09-25T00:00:00Z", freshness: "current", summary: id }] }; }
