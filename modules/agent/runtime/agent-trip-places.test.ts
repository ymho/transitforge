import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createAgentContextSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { agentDecisionContextText, buildAgentDecisionContext } from "@raiquora/agent/agent-decision-context";
import { multiCityTrip, placeActivity, resolvedPlace, placesTripId, placesAt } from "../../trip/domain/trip-places.fixture";

it("keeps requested, actual, summary, candidates and realtime separate in model context", () => {
  const base = multiCityTrip(), trip = { ...base, request: { constraints: [{ id: "wishes", strength: "soft" as const, source: "user" as const,
    scope: { type: "trip" as const }, requirement: { type: "destinations" as const, order: "fixed" as const, places: [resolvedPlace("Zermatt")] } }], assumptions: [] } };
  const snapshot = createAgentContextSnapshot(undefined, trip).trip!;
  expect(snapshot).not.toHaveProperty("destination"); expect(snapshot.summaryDestination).toBe("オーストリア・スイス");
  expect(snapshot.itineraryPlaces?.visitedPlaces.map((p) => p.place.name)).toEqual(["Vienna", "Salzburg", "Salzburgの宿", "Zürich"]);
  expect(snapshot.itineraryPlaces?.overnightPlaces.map((p) => p.place.name)).toEqual(["Salzburgの宿"]);
  expect(snapshot.itineraryPlaces?.transportEndpoints[0]?.origin.name).toBe("Vienna");
  expect(snapshot.placesTruncated).toBe(false);
  const context = buildAgentDecisionContext({ executionId: "multi", feature: "concierge", userRequest: "自由時間を追加したい", context: {
    currentTrip: { ...snapshot }, travelCandidates: [{ name: "Paris" }], realtimeFacts: [{ status: "unknown" }],
  } }, []);
  expect(JSON.stringify(context.currentTrip)).not.toMatch(/Zermatt|Paris/);
  expect(JSON.stringify(context.persistedTripRequest)).toContain("Zermatt");
  expect(context.currentTrip).not.toHaveProperty("destination");
  expect(context.travelCandidates).toEqual([{ name: "Paris" }]);
  expect(JSON.stringify(context)).not.toContain("source-Zürich");
});
it("explicitly marks list/text omission and never manufactures an opaque identity", () => {
  const trip = createTrip(placesTripId, "many", placesAt, Array.from({ length: 30 }, (_, i) => placeActivity(`p${i}`,
    resolvedPlace(i === 0 ? "a".repeat(101) : `P${i}`, i === 1 ? "x".repeat(257) : `id${i}`))));
  const snapshot = createAgentContextSnapshot(undefined, trip).trip!;
  expect(snapshot.itineraryPlaces?.visitedPlaces).toHaveLength(24); expect(snapshot.placesTruncated).toBe(true);
  expect(snapshot.itineraryPlaces?.visitedPlaces[1]?.place).not.toHaveProperty("ref");
  expect(snapshot.itineraryPlaces?.visitedPlaces[0]?.place.name).toHaveLength(100);
});
it("retains exact IDs and omission semantics through all context compression stages", () => {
  // Full-width / whitespace in opaque IDs must not be normalized into another provider ID.
  const trip = createTrip(placesTripId, "many", placesAt, Array.from({ length: 24 }, (_, i) => placeActivity(`p${i}`, resolvedPlace(`P${i}`, ` Ａ:${i} `))),
    undefined, undefined, "表示だけ");
  const snapshot = createAgentContextSnapshot(undefined, trip).trip!;
  expect(snapshot.placesTruncated).toBe(false);
  const context = buildAgentDecisionContext({ executionId: "compressed", feature: "concierge", userRequest: "整理して", context: {
    currentTrip: { ...snapshot }, currentJourney: { journeys: Array.from({ length: 20 }, () => ({ legs: Array.from({ length: 20 }, () => ({ description: "detail".repeat(100) })) })) },
  } }, []);
  expect(context.currentTrip?.placesTruncated).toBe(true); // 24 -> 20 at the general context boundary
  const encoded = agentDecisionContextText(context), parsed = JSON.parse(encoded.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
  expect(parsed.currentTrip.itineraryPlaces.visitedPlaces.length).toBeLessThan(20);
  expect(parsed.currentTrip.itineraryPlaces.visitedPlaces.map((p: { itemId: string }) => p.itemId))
    .toEqual(Array.from({ length: parsed.currentTrip.itineraryPlaces.visitedPlaces.length }, (_, i) => `p${i}`));
  expect(parsed.currentTrip.itineraryPlaces.visitedPlaces[0].place.ref.providerPlaceId).toBe(" Ａ:0 ");
  expect(parsed.currentTrip.placesTruncated).toBe(true);
  expect(parsed.currentTrip.summaryDestination).toBe("表示だけ");
  expect(parsed.currentTrip.placeSemantics).toContain("incomplete");
  expect(parsed.currentTrip).not.toHaveProperty("destination");
  expect(encoded).not.toContain("[depth-limited]");
});
