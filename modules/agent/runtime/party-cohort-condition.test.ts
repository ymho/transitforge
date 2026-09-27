import { describe, expect, it } from "vitest";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { parsePartyCohorts, projectPartyAtScope, type PartyScopeCatalog } from "@raiquora/trip/party-cohorts";
import { partyDetailsUpdateInputSchema } from "./party-cohort-condition";
import { admitConditionChange, admitTripScenario, conditionDelta, conditionPayload, parseConditionJournal } from "./conversation-condition";
import { reduceConversationIntent } from "./conversation-intent-reducer";
import { compileEffectiveIntent } from "./effective-intent";
import { admitAgentV2Reply } from "./agent-v2-publication";
import { partyCohortContext, partyCohortReadBoundary } from "./party-cohort-context";

const cohort = { count: 1, membership: "baseline" as const, schoolStage: "university" as const, ageDecade: "twenties" as const, scope: { kind: "whole_trip" as const } };
const quote = "20代の大学生1人", input = { target: "party_details" as const, cohorts: [cohort], quote };
const catalog: PartyScopeCatalog = { tripId: "trip", tripRevision: 2,
  days: [{ id: "known-a", label: "初日" }, { id: "known-b", label: "2日目" }], segments: [] };

describe("V2 cohort condition business slot", () => {
  it("requires the final replacement value and forbids procedural actions, identity, fare and raw scope IDs", () => {
    expect(partyDetailsUpdateInputSchema.safeParse({ finalCohorts: [cohort], quote }).success).toBe(true);
    expect(partyDetailsUpdateInputSchema.safeParse({ finalCohorts: null, quote }).success).toBe(true);
    for (const wrong of [{ quote }, { finalCohorts: [], quote }, { action: "clear", quote }, { action: "set", cohorts: [cohort], quote },
      { action: "clear", finalCohorts: [cohort], quote },
      { finalCohorts: [{ ...cohort, name: "someone" }], quote },
      { finalCohorts: [{ ...cohort, fareClass: "child" }], quote },
      { finalCohorts: [{ ...cohort, scope: { kind: "logical_days", dayIds: ["invented"] } }], quote },
      { finalCohorts: [{ ...cohort, scope: { kind: "segment", segmentId: "invented" } }], quote }])
      expect(partyDetailsUpdateInputSchema.safeParse(wrong).success).toBe(false);
  });
  it("uses one receipt/revision without modifying the global count, Trip or Profile", () => {
    const before = reduceConversationIntent(emptyConversationIntentOverlay(), conditionDelta({ target: "party_size", party: { kind: "count", people: 3 }, quote: "3人" }, "count", emptyConversationIntentOverlay())).overlay;
    const change = admitConditionChange(input, quote);
    const reduced = reduceConversationIntent(before, conditionDelta(change, "details", before));
    expect(reduced.overlay.intentRevision).toBe(2);
    expect(reduced.receipt.operations).toHaveLength(1);
    expect(reduced.receipt.mutationId).toBe("condition:details:party_details");
    expect(reduced.overlay.facts.find(fact => fact.target === "party_size")?.value).toEqual({ kind: "quantity", amount: 3, unit: "people" });
    expect(reduced.overlay.facts.find(fact => fact.target === "party_details")?.value).toEqual({ kind: "party_cohorts", cohorts: [cohort] });
    const journal = { version: 1, operations: [{ target: "party_details", payloadHash: "a".repeat(64), receipt: reduced.receipt }] };
    expect(parseConditionJournal(journal, "details").operations).toHaveLength(1);
    const cleared = reduceConversationIntent(reduced.overlay, conditionDelta({ target: "party_details", cohorts: null, quote: "詳細は未定" }, "clear", reduced.overlay));
    expect(cleared.overlay.facts.map(f => f.target)).toEqual(["party_size"]);
    expect(cleared.overlay.tombstones.some(t => t.target === "party_details")).toBe(true);
  });
  it("atomically replaces withdrawn details with new details in one final decision", () => {
    const initial = emptyConversationIntentOverlay();
    const prior = reduceConversationIntent(initial, conditionDelta(admitConditionChange(input, quote), "prior", initial)).overlay;
    const message = "前の属性は取り消し、全行程に小学生1人です";
    const child = { count: 1, membership: "baseline" as const, schoolStage: "elementary" as const, scope: { kind: "whole_trip" as const } };
    const change = admitConditionChange({ target: "party_details", cohorts: [child], quote: message }, message);
    const result = reduceConversationIntent(prior, conditionDelta(change, "replace", prior));
    expect(result.overlay.intentRevision).toBe(prior.intentRevision + 1);
    expect(result.receipt.operations).toHaveLength(1);
    expect(result.overlay.facts.find(f => f.target === "party_details")?.value).toEqual({ kind: "party_cohorts", cohorts: [child] });
    expect(result.overlay.facts.some(f => f.value.kind === "party_cohorts" && f.value.cohorts.some(c => c.ageDecade))).toBe(false);
  });
  it("corrects a previously accepted misunderstanding on a new turn without changing unrelated people or global count", () => {
    const threeDays = { ...catalog, days: [...catalog.days, { id: "known-c", label: "3日目" }] };
    const child = { count: 1, membership: "baseline" as const, schoolStage: "elementary" as const, scope: { kind: "whole_trip" as const } };
    const adult = { count: 1, membership: "baseline" as const, ageDecade: "thirties" as const, scope: { kind: "whole_trip" as const } };
    const scopedChild = { ...child, scope: { kind: "logical_days" as const, tripId: catalog.tripId, tripRevision: catalog.tripRevision, dayIds: ["known-a", "known-b"] } };
    const initial = emptyConversationIntentOverlay();
    const baseline = reduceConversationIntent(initial, conditionDelta({ target: "party_size", party: { kind: "count", people: 3 }, quote: "3人" }, "count", initial)).overlay;
    // A syntactically valid but semantically mistaken prior model decision.
    const wrong = reduceConversationIntent(baseline, conditionDelta({ target: "party_details", cohorts: parsePartyCohorts([child, scopedChild, adult]), quote: "以前の合成条件" }, "mistaken-turn", baseline)).overlay;
    const message = "小学生は1人だけで2日目まで参加です。全行程の小学生という重複は取り消して。30代の人と合計3人はそのままです。";
    const corrected = admitConditionChange({ target: "party_details", cohorts: [adult, { ...child, scope: { kind: "logical_days", fromDay: 1, toDay: 2 } }], quote: message }, message, undefined, threeDays);
    const result = reduceConversationIntent(wrong, conditionDelta(corrected, "user-correction", wrong));
    expect(result.overlay.intentRevision).toBe(wrong.intentRevision + 1);
    expect(result.receipt.operations).toHaveLength(1);
    expect(result.receipt.mutationId).toBe("condition:user-correction:party_details");
    expect(result.overlay.facts.find(f => f.target === "party_details")?.value).toEqual({ kind: "party_cohorts", cohorts: parsePartyCohorts([adult, scopedChild]) });
    expect(result.overlay.facts.find(f => f.target === "party_size")).toEqual(baseline.facts.find(f => f.target === "party_size"));
    expect(projectPartyAtScope([adult, scopedChild], 3, threeDays, { kind: "logical_day", dayId: "known-a" })).toMatchObject({ status: "known", people: 3 });
    expect(projectPartyAtScope([adult, scopedChild], 3, threeDays, { kind: "logical_day", dayId: "known-c" })).toMatchObject({ status: "known", people: 2 });
  });
  it("does not infer same-person identity merely from equal attributes", () => {
    const sameAttributesDifferentPeople = [cohort, { ...cohort, scope: { kind: "logical_days" as const, tripId: catalog.tripId, tripRevision: catalog.tripRevision, dayIds: ["known-a"] } }];
    expect(parsePartyCohorts(sameAttributesDifferentPeople)).toHaveLength(2);
  });
  it("allows clarification of a change target even when prior details are known, without mutating intent", () => {
    const initial = emptyConversationIntentOverlay();
    const overlay = reduceConversationIntent(initial, conditionDelta(admitConditionChange(input, quote), "prior", initial)).overlay;
    const snapshot = structuredClone(overlay), intent = compileEffectiveIntent({ overlay });
    const reply = admitAgentV2Reply({ kind: "clarification", target: "participation_scope" }, { executionId: "clarify", evidence: [], effectiveIntent: intent });
    expect(reply.proof).toMatchObject({ kind: "clarification", question: "participation_scope" });
    expect(overlay).toEqual(snapshot);
  });
  it("rejects an ungrounded quote and detail count exceeding the already accepted baseline", () => {
    expect(() => admitConditionChange(input, "別のメッセージ")).toThrow("invalid_source");
    const before = reduceConversationIntent(emptyConversationIntentOverlay(), conditionDelta({ target: "party_size", party: { kind: "count", people: 1 }, quote: "1人" }, "count", emptyConversationIntentOverlay())).overlay;
    const change = admitConditionChange({ ...input, cohorts: [{ ...cohort, count: 2 }] }, quote);
    expect(() => conditionDelta(change, "details", before)).toThrow("invalid_condition");
  });
  it("resolves scenario scope without creating an operation or changing actual conditions", () => {
    const scenario = { kind: "party_details", cohorts: [{ ...cohort, membership: "additional", scope: { kind: "logical_days", fromDay: 2 } }], quote: "もし2日目から1人なら" };
    expect(() => admitTripScenario(scenario, scenario.quote)).toThrow("scope_required");
    expect(admitTripScenario(scenario, scenario.quote, catalog)).toMatchObject({ kind: "party_details", cohorts: [{ scope: {
      kind: "logical_days", tripId: "trip", tripRevision: 2, dayIds: ["known-b"],
    } }] });
    expect(() => admitTripScenario({ ...scenario, budget: { amount: 10 } }, scenario.quote, catalog)).toThrow("invalid_condition");
  });
  it("keeps baseline/scoped details apart and fences currentness on dependent reads only", () => {
    const change = admitConditionChange({ ...input, cohorts: [{ ...cohort, scope: { kind: "logical_days", fromDay: 2 } }] }, quote, undefined, catalog);
    const overlay = reduceConversationIntent(emptyConversationIntentOverlay(), conditionDelta(change, "details", emptyConversationIntentOverlay())).overlay;
    const intent = compileEffectiveIntent({ overlay });
    expect(partyCohortContext(intent, catalog).status).toBe("scoped");
    expect(partyCohortReadBoundary(intent, ["party_size"], catalog)).toBe("product_participation_scope_required");
    expect(partyCohortReadBoundary(intent, ["destination", "start_date"], catalog)).toBeUndefined();
    expect(partyCohortReadBoundary(intent, ["party_size"], { ...catalog, tripRevision: 3 })).toBe("stale_scope");
    const changed = admitConditionChange({ ...input, cohorts: [{ ...cohort, scope: { kind: "logical_days", fromDay: 2 } }] }, quote, undefined, { ...catalog, tripRevision: 3 });
    expect(conditionPayload(changed)).not.toBe(conditionPayload(change));
  });
});
