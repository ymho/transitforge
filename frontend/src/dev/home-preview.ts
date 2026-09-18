import { createTrip, type Trip } from "@raiquora/trip/trip";
import type { TripWorkspaceSource } from "../usecases/trip-plan/trip-workspace-controller";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { assessTravelCandidate } from "@raiquora/trip/assess-travel-candidate";
import { railSelectionFixture } from "../../../modules/trip/domain/selected-rail-journey.fixture";

/** Development-only, read-only source. No writer, provider claims, real booking or server connection. */
export function homePreviewSource(): TripWorkspaceSource {
  const trip: Trip = { ...createTrip("45300000-0000-4000-8000-000000000001", "ゆっくり街を歩く旅（開発サンプル）", "2026-09-18T00:00:00Z", [
    { id: "walk", type: "activity", category: "free-time", title: "街歩き（サンプル・未調査）", schedule: { type: "day", date: "2026-10-20", timeZone: "Asia/Tokyo" } },
    { id: "museum", type: "activity", category: "sightseeing", title: "地域の文化に触れる（サンプル・未調査）", schedule: { type: "day", date: "2026-10-21", timeZone: "Asia/Tokyo" } },
  ], { constraints: [], assumptions: [], party: { adults: 2, children: [], source: "user" } }), adoption: { confirmedAt: "2026-09-18T00:00:00Z" } };
  const candidates = ["海辺を歩く旅", "町並みを楽しむ旅", "のんびり過ごす旅"].map((name, index) => {
    // Exercise the same assessor/filter as production using explicitly synthetic timetable inputs.
    const fixture = railSelectionFixture(); fixture.candidate.candidateId = `home-preview-${index}`;
    const candidate = createTravelCandidate({ id: fixture.candidate.candidateId, journey: fixture.candidate.journey,
      experiences: [{ kind: "experience", provider: "preview", providerItemId: `example-${index}`, name: `${name}（サンプル）`, startDate: fixture.candidate.legReferences[0]!.serviceDate }] });
    return { candidate, assessment: assessTravelCandidate(trip, candidate, { candidateId: candidate.id,
      rail: { candidate: fixture.candidate, inputs: fixture.inputs } }, fixture.selectedAt) };
  });
  return { getCurrentTrip: () => structuredClone(trip), getLoadState: () => "loaded", getCandidates: () => structuredClone(candidates) };
}
