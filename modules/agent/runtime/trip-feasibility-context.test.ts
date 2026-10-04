import { expect, it } from "vitest";
import { evaluateTripFeasibility } from "@raiquora/trip/trip-feasibility";
import { feasibilityTrip, feasibilityNow, feasibilityFacts, feasibilityStayTrip } from "../../trip/domain/trip-feasibility.fixture";
import { tripFeasibilityContext } from "@raiquora/agent/trip-feasibility-context";

it("keeps three-valued derived result separate from Trip/Reservation", () => {
  const trip = feasibilityTrip();
  const evaluation = evaluateTripFeasibility(trip, undefined, feasibilityNow);
  const feasibility = tripFeasibilityContext(evaluation);
  expect(feasibility.status).toBe("unknown");
  expect(trip).not.toHaveProperty("tripFeasibility");
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
it("does not turn a ready overnight Trip's informational unknown into proof of feasibility", () => {
  const { trip, facts } = feasibilityStayTrip();
  const ready = { ...trip, planningState: "ready" as const };
  const context = tripFeasibilityContext(evaluateTripFeasibility(ready, facts, feasibilityNow));
  expect(context.status).toBe("unknown");
  expect(context.issues.map((i) => i.code)).toContain("stay_time_precision");
  expect(context.issues).toContainEqual(expect.objectContaining({ code: "stay_visit_unchecked", status: "unknown", itemIds: ["hotel"] }));
});
