import { expect, it } from "vitest";
import { evaluateTripFeasibility } from "@raiquora/trip/trip-feasibility";
import { feasibilityTrip, feasibilityNow, feasibilityFacts } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { tripFeasibilityContext } from "./trip-feasibility-context";
import { buildAgentDecisionContext, agentDecisionContextText } from "./agent-decision-context";

it("keeps three-valued derived result separate from Trip/Reservation and in every context budget", () => {
  const trip = feasibilityTrip();
  const evaluation = evaluateTripFeasibility(trip, undefined, feasibilityNow);
  const feasibility = tripFeasibilityContext(evaluation);
  const context = buildAgentDecisionContext({ executionId: "test", feature: "concierge", userRequest: "この旅程は問題ない？",
    context: { currentTrip: { id: trip.id, revision: trip.revision, request: trip.request }, tripFeasibility: feasibility } }, []);
  expect(context.tripFeasibility?.status).toBe("unknown"); expect(context.currentTrip).not.toHaveProperty("tripFeasibility");
  expect(agentDecisionContextText(context)).toContain('"tripFeasibility"');
  expect(agentDecisionContextText({ ...context, conversation: { messages: Array.from({ length: 100 }, () => ({ role: "user" as const, text: "a".repeat(1000) })) } })).toContain('"tripFeasibility"');
});
it("never projects arbitrary private data or hides a violation by truncation", () => {
  const trip = feasibilityTrip(), evaluation = evaluateTripFeasibility(trip, feasibilityFacts(trip), feasibilityNow);
  const result = tripFeasibilityContext({ ...evaluation, status: "infeasible", issues: [
    ...Array.from({ length: 30 }, () => ({ code: "schedule_unknown" as const, status: "unknown" as const, severity: "warning" as const, itemIds: ["activity"] })),
    { code: "reservation_conflict", status: "violated", severity: "error", itemIds: ["activity"], details: { bookingReference: "PRIVATE" }, bookingReference: "PRIVATE" } as never,
  ] });
  expect(result).toMatchObject({ status: "infeasible", truncated: true, totalIssueCount: 31 });
  expect(result.issues[0]!.code).toBe("reservation_conflict");
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|bookingReference/);
});
