import { describe, expect, it } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { areaInput, areaHazardEvent, areaNow } from "../../../../modules/trip/domain/area-trip-impact.fixture";
import { evaluateAreaTripImpact } from "@raiquora/trip/area-trip-impact";
import { buildInTripContext } from "@raiquora/trip/in-trip-context";
import { inTripApplicationEvidence } from "./in-trip-application-evidence";
import { validateEvidenceAndClaims } from "./evidence-model";
import { buildAgentDecisionContext, agentDecisionContextText } from "./agent-decision-context";

describe("InTrip Application Evidence", () => {
  it("projects adopted next itinerary and saved rail typed facts, without recalculation or mutation", () => {
    const f = inTripFixture(), before = JSON.stringify(f.snapshot), values = inTripApplicationEvidence(f.snapshot);
    expect(validateEvidenceAndClaims(values, []).valid).toBe(true);
    const plan = values.find((e) => e.subject === "inTrip.itinerary")!;
    expect(plan.knowledgeKind).toBe("deterministic_fact"); expect(plan.facts.next).toContain("庭園");
    expect(plan.coverage).toEqual(["trip.itinerary", "trip.next-item", "rail.schedule"]);
    expect(plan.references[0]!.summary).toContain("実際の現在地・乗車確認ではない");
    const impact = values.find((e) => e.references[0]!.sourceType === "trip-impact")!;
    expect(impact.knowledgeKind).toBe("derived_value");
    expect(impact.coverage).toEqual(["rail.impact", "rail.connection"]);
    expect(JSON.parse(String(impact.facts.typedFacts))).toEqual(f.snapshot.impacts.items[0]!.facts);
    expect(impact.facts.typedFacts).toContain("connection-buffer");
    expect(JSON.stringify(f.snapshot)).toBe(before);
    expect(JSON.stringify(values)).not.toMatch(/owner|impactId|bookingReference|providerAlertId|raw|longitude|latitude/);
  });
  it("retains weather/hazard uncertainty without promoting it to safety", () => {
    const inputs = [areaInput(), areaInput(areaHazardEvent())], trip = { ...inputs[0]!.trip, lifecycleState: "in_trip" as const };
    const snapshot = buildInTripContext(trip, { at: areaNow, timeZone: "UTC" }, { tripConfirmed: true,
      impacts: inputs.map((input) => ({ impact: evaluateAreaTripImpact({ ...input, trip }), observedAt: areaNow,
        expiresAt: "2026-09-12T09:00:00Z", fresh: true })) })!;
    const impacts = inTripApplicationEvidence(snapshot).filter((e) => e.references[0]!.sourceType === "trip-impact");
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.id).toBe("application:in-trip:environment");
    expect(JSON.parse(String(impacts[0]!.facts.impacts)).map((i: { facts: unknown }) => i.facts)).toEqual(snapshot.impacts.items.map((i) => i.facts));
    expect(JSON.stringify(impacts)).toContain("uncertainty");
    expect(impacts.every((e) => e.references[0]!.summary.includes("未確認"))).toBe(true);
  });
  it("bounds to ten; includes only relevant known reservation facts and location state, never coordinates", () => {
    const { snapshot } = inTripFixture();
    snapshot.impacts.items = Array.from({ length: 6 }, () => structuredClone(snapshot.impacts.items[0]!));
    snapshot.reservations.items = [{ kind: "transport", status: "booked", itineraryItemId: snapshot.itinerary.current[0]!.itemId },
      { kind: "accommodation", status: "unknown", itineraryItemId: "garden" }, { kind: "activity", status: "booked", itineraryItemId: "unrelated" }];
    snapshot.location = { status: "available", consent: "explicit", observedAt: snapshot.now.at, longitude: 135, latitude: 35, accuracyMeters: 10 };
    const values = inTripApplicationEvidence(snapshot);
    expect(values).toHaveLength(10); expect(new Set(values.map((e) => e.id)).size).toBe(10);
    const reservations = values.find((e) => e.references[0]!.sourceType === "reservation-state")!;
    expect(JSON.parse(String(reservations.facts.reservations))).toEqual([snapshot.reservations.items[0]]);
    expect(JSON.stringify(values)).not.toMatch(/longitude|latitude|accuracyMeters|bookingReference/);
    snapshot.location = { status: "permission-denied" };
    expect(inTripApplicationEvidence(snapshot).find((e) => e.subject === "inTrip.location")!.facts).toEqual({ status: "permission-denied" });
  });
  it("does not trust remote failure, unavailable facts, unknown Impact or extra private payloads", () => {
    const { snapshot } = inTripFixture();
    expect(inTripApplicationEvidence({ ...snapshot, trip: { ...snapshot.trip, currency: "unconfirmed" } })).toEqual([]);
    snapshot.impacts.items[0]!.status = "unknown"; snapshot.impacts.items[0]!.severity = "informational";
    const unknown = inTripApplicationEvidence(snapshot).find((e) => e.references[0]!.sourceType === "trip-impact")!;
    expect(unknown.knowledgeKind).toBe("unverified_information"); expect(unknown.references[0]!.freshness).toBe("unknown");
    snapshot.impacts.status = "unavailable"; snapshot.reservations.status = "unavailable";
    expect(inTripApplicationEvidence(snapshot).some((e) => ["trip-impact", "reservation-state"].includes(e.references[0]!.sourceType))).toBe(false);
    expect(() => inTripApplicationEvidence({ ...snapshot, ownerSubject: "PRIVATE" } as never)).toThrow();
    const poisoned = structuredClone(snapshot); Object.assign(poisoned.impacts.items[0]!, { raw: "PRIVATE" });
    expect(() => inTripApplicationEvidence(poisoned)).toThrow();
  });
  it("prioritizes initial Evidence over place summaries and preserves verifiedFacts through compression", () => {
    const f = inTripFixture(), initialEvidence = inTripApplicationEvidence(f.snapshot);
    const context = buildAgentDecisionContext({ executionId: "test", feature: "concierge", userRequest: "次は？", initialEvidence,
      context: { inTrip: f.snapshot, verifiedFacts: Array.from({ length: 22 }, (_, i) => ({
        evidenceId: i ? `place-${i}` : initialEvidence[0]!.id, category: "place", subject: "地点", summary: "未採用候補" })),
      travelProfile: { preference: "自然" }, conversation: { summary: "未検証の要約", messages: Array.from({ length: 30 }, () => ({ role: "user" as const, text: "長い履歴".repeat(200) })) } } }, []);
    expect(context.verifiedFacts).toHaveLength(20);
    expect(context.verifiedFacts.slice(0, initialEvidence.length).map((f) => f.evidenceId)).toEqual(initialEvidence.map((e) => e.id));
    expect(new Set(context.verifiedFacts.map((f) => f.evidenceId)).size).toBe(20);
    const text = agentDecisionContextText(context), compressed = JSON.parse(text.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(compressed.verifiedFacts.slice(0, initialEvidence.length)).toEqual(context.verifiedFacts.slice(0, initialEvidence.length).map((f) => ({ evidenceId: f.evidenceId, sourceType: f.sourceType })));
    expect(text).toContain("<verified_evidence>");
    expect(text.split(context.verifiedFacts[0]!.summary).length - 1).toBe(1);
    expect(text).toContain("inTripAnswerPlan");
    expect(text).toContain("Application renderer"); expect(text).toContain("最大6件");
    expect(text.match(/<verified_evidence>([\s\S]*?)<\/verified_evidence>/u)![1]!.length + JSON.stringify(compressed).length).toBeLessThanOrEqual(24_000);
    expect(JSON.stringify(initialEvidence)).not.toMatch(/未検証の要約|未採用候補/);
  });
  it("does not add an in-trip answer mode or Evidence brief for unverified planning context", () => {
    const context = buildAgentDecisionContext({ executionId: "planning", feature: "concierge", userRequest: "旅行したい", context: { travelProfile: { likes: "海" } } }, []);
    const text = agentDecisionContextText(context);
    expect(text).not.toContain("<verified_evidence>"); expect(text).not.toContain("旅行中の回答契約");
  });
});
