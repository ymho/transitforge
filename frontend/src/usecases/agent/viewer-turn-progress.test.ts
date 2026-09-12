import { describe, expect, it } from "vitest";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "@raiquora/trip/selected-rail-journey";
import type { TravelPlan } from "@raiquora/trip/travel-plan";
import type { TripUpdateProposal, TransportItineraryItem } from "@raiquora/trip/trip";
import { observeViewerTurn } from "./viewer-turn-progress";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";

const progressSource: ExternalSourceEvidence = { id: "place", kind: "place", provider: "synthetic", sourceId: "a", retrievedAt: "2026-09-12T08:00:00Z", confidence: "observed" };

const fixture = railSelectionFixture();
const route = { originStation: "A", destinationStation: "C", serviceDate: "2026-09-13", journeys: [fixture.candidate.journey] };
const travelPlan: TravelPlan = { destination: "C", dayTrip: true, checkInDate: "2026-09-13", checkOutDate: "2026-09-13",
  outbound: route, returning: { ...route, journeys: [] }, accommodations: [] };
const selected = selectRailJourney(fixture.candidate, fixture.inputs, fixture.selectedAt);
const item: TransportItineraryItem = { id: "outbound", title: "往路", type: "transport", schedule: projectRailSchedule(selected), detail: { mode: "rail", status: "selected", journey: selected } };
const kinds = (value: Parameters<typeof observeViewerTurn>[0]) => observeViewerTurn(value, []).progress.map((p) => p.kind);

describe("shared visible milestone classification", () => {
  it("counts dated legacy movements and V2 selected item previews as itinerary, not just state", () => {
    expect(kinds({ text: "", travelPlan })).toEqual(["itinerary"]);
    const tripUpdateProposal: TripUpdateProposal = { tripId: "trip", summary: "採用案", patches: [{ type: "replace", itemId: item.id, item }] };
    expect(kinds({ text: "", tripUpdateProposal })).toEqual(["trip_proposal", "itinerary"]);
    expect(kinds({ text: "", tripPlanUpdate: { summary: "追加案", patches: [{ type: "add", item: { type: "movement", mode: "rail", id: "leg", route } }] } })).toEqual(["trip_proposal", "itinerary"]);
  });
  it("distinguishes a comparable route search from an adopted itinerary", () => {
    expect(kinds({ text: "", journeyPlan: route })).toEqual(["comparison", "candidates"]);
    expect(kinds({ text: "", journeyPlan: { ...route, journeys: [] } })).toEqual([]);
  });
  it("rejects empty TravelPlans and unresolved/state/request/assumption-only previews", () => {
    expect(kinds({ text: "旅程を作りました", travelPlan: { ...travelPlan, outbound: { ...route, journeys: [] } } })).toEqual([]);
    const patches: TripUpdateProposal["patches"] = [
      { type: "planning", state: "itinerary_draft" },
      { type: "request", request: { constraints: [], assumptions: [] } },
      { type: "replace", itemId: "outbound", item: { ...item, schedule: { type: "unscheduled" }, detail: { status: "unresolved" } } },
    ];
    for (const patch of patches) expect(kinds({ text: "旅程を作りました", tripUpdateProposal: { tripId: "trip", summary: "", patches: [patch] } })).toEqual([]);
    expect(kinds({ text: "", tripPlanUpdate: { summary: "", patches: [{ type: "metadata", title: "itinerary_draft" }] } })).toEqual([]);
    expect(kinds("旅程を作りました。温泉方面がおすすめです。")).toEqual([]);
  });
  it("requires named nonempty candidate identities and public evidence", () => {
    const place = { providerPlaceId: "a", name: "評価用候補A", sourceUrl: "https://example.com", openingHoursStatus: "unknown" as const };
    for (const places of [[], [{ ...place, name: "" }], [{ ...place, providerPlaceId: " " }]]) {
      expect(kinds({ text: "", external: { places: { status: "available", freshness: "fresh", evidence: [progressSource], data: { places } } } })).toEqual([]);
    }
    expect(kinds({ text: "", external: { places: { status: "available", freshness: "fresh", evidence: [progressSource], data: { places: [place] } } } })).toEqual(["candidates"]);
    expect(kinds({ text: "", external: { places: { status: "available", freshness: "fresh", evidence: [], data: { places: [place] } } } })).toEqual([]);
  });
});
