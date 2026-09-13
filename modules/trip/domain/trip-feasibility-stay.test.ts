import { it, expect } from "vitest";
import { stayDateRelation } from "./trip-feasibility-stay";
import { feasibilityStayTrip, feasibilityActivity, feasibilityInstant as at, feasibilityFacts, feasibilityNow } from "./trip-feasibility.fixture";
import { requestTrip } from "./trip-request.fixture";
import { evaluateTripFeasibility } from "./trip-feasibility";

it("compares dates without occupying the stay span or assuming check-in hours", () => {
  const { stay } = feasibilityStayTrip();
  const activity = (date: string) => ({ ...feasibilityActivity(), schedule: { type: "fixed" as const, startAt: at(12, date), endAt: at(13, date) } });
  for (const date of ["2026-09-22", "2026-09-23"]) {
    expect(stayDateRelation(activity(date), stay)).toBe("precision");
    expect(stayDateRelation(stay, activity(date))).toBe("precision");
    const trip = requestTrip(undefined, [stay, activity(date)]);
    expect(evaluateTripFeasibility(trip, feasibilityFacts(trip), feasibilityNow).issues.some((i) => i.code === "schedule_overlap")).toBe(false);
  }
  expect(stayDateRelation(activity("2026-09-24"), stay)).toBe("violated");
  expect(stayDateRelation(stay, activity("2026-09-21"))).toBe("violated");
  expect(stayDateRelation(activity("2026-09-23"), stay, 1440)).toBe("violated");
  const invalid = requestTrip(undefined, [activity("2026-09-24"), stay]);
  expect(evaluateTripFeasibility(invalid, feasibilityFacts(invalid), feasibilityNow).status).toBe("infeasible");
});
it("uses the stay's explicit timezone, and never falls back to browser timezone", () => {
  const { stay } = feasibilityStayTrip();
  const activity = { ...feasibilityActivity(), schedule: { type: "fixed" as const,
    startAt: { at: "2026-09-23T15:00:00Z", timeZone: "UTC" }, endAt: { at: "2026-09-23T16:00:00Z", timeZone: "UTC" } } };
  expect(stayDateRelation(activity, stay)).toBe("violated"); // Sep 24 in Japan
  expect(stayDateRelation({ ...activity, schedule: { type: "unscheduled" } }, stay)).toBe("unknown");
  expect(stayDateRelation(activity, { ...stay, schedule: { type: "day", date: "2026-09-22", endDate: "2026-09-23" } })).toBe("unknown");
});
