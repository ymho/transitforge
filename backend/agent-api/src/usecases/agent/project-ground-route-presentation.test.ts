import { expect, it } from "vitest";
import { projectGroundRoutePresentation } from "./project-ground-route-presentation.js";

const longGeometry = Array.from({ length: 650 }, (_, i) => [132.7 + i / 10_000, 35.4 + i / 10_000]);
const output = { groundRoutes: { status: "available", checkedAt: "2026-09-28T01:00:00Z",
  coverage: { feedUrl: "https://example.org/feed.zip", feedRetrievedAt: "2026-09-28T00:00:00Z", attribution: "Example feed" }, routes: [{
    departureAt: "2026-10-01T09:00:00+09:00", arrivalAt: "2026-10-01T09:30:00+09:00", durationMinutes: 30,
    legs: [{ mode: "bus", from: "駅前", to: "大社前", departureAt: "2026-10-01T09:00:00+09:00",
      arrivalAt: "2026-10-01T09:30:00+09:00", routeName: "路線", geometry: longGeometry }],
  }] }, searchContext: { tripId: "trip" } };

it("projects bounded referenced geometry with source and as-of data", () => {
  const presentation = projectGroundRoutePresentation("evidence-1", output)!;
  expect(presentation).toMatchObject({ version: "public-ground-route-v1", evidenceId: "evidence-1", originName: "駅前", destinationName: "大社前",
    routes: [{ legs: [{ geometry: expect.any(Array) }] }] });
  expect(presentation.routes[0]!.legs[0]!.geometry).toHaveLength(300);
  expect(presentation.routes[0]!.legs[0]!.geometry[0]).toEqual(longGeometry[0]);
  expect(presentation.routes[0]!.legs[0]!.geometry.at(-1)).toEqual(longGeometry.at(-1));
  expect(projectGroundRoutePresentation("evidence-1", { ...output, groundRoutes: { ...output.groundRoutes, status: "no_route" } })).toBeUndefined();
});

it("draws two verified route segments around an explicitly assumed candidate stay", () => {
  const continuation = { firstRouteIndex: 0, requestedCandidateStayMinutes: 30, scheduleAssessments: ["fits_next_deadline"],
    result: { status: "available", routes: [{ departureAt: "2026-10-01T10:00:00+09:00", arrivalAt: "2026-10-01T10:20:00+09:00", durationMinutes: 20,
      legs: [{ mode: "walk", from: "大社前", to: "宿", departureAt: "2026-10-01T10:00:00+09:00", arrivalAt: "2026-10-01T10:20:00+09:00",
        geometry: [[132.8, 35.5], [132.81, 35.51]] }] }] } };
  const presentation = projectGroundRoutePresentation("evidence-2", { ...output, searchContext: { continuation: [continuation] } })!;
  expect(presentation.destinationName).toBe("宿");
  expect(presentation.routes[0]).toMatchObject({ durationMinutes: 80, via: { name: "大社前", stayMinutes: 30,
    afterLegIndex: 1, nextDeadlineAssessment: "fits_next_deadline" }, legs: [{ mode: "bus" }, { mode: "walk" }] });
});
