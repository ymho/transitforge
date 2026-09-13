import { describe, it, expect } from "vitest";
import { validateTripParty, type TripParty } from "./trip-party";
import { requestTrip } from "./trip-request.fixture";
import { partyRequest } from "./trip-party.fixture";
import { applyTripProposal } from "./trip";

const base: TripParty = { adults: 1, children: [], source: "user" };
describe("TripParty aggregate contract", () => {
  it.each([
    { adults: 1, composition: ["solo"] }, { adults: 2, composition: ["partner"] }, { adults: 2, composition: ["friends"] },
    { adults: 2, children: [{}] }, { adults: 0, children: [{}] }, { children: [{ ageGroup: "preschool" }] },
    { children: [{ age: 0 }] }, { children: [{ age: 8, ageGroup: "elementary" }] },
    { adults: 1_000_000 }, { children: [{ age: 40, ageGroup: "baby" }] },
  ])("preserves counts/unknown age without inventing provider age bands: %j", (fields) => {
    const party = { ...base, ...fields } as TripParty;
    const before = structuredClone(party);
    expect(requestTrip({ constraints: [], assumptions: [], party }).request.party).toEqual(party);
    expect(party).toEqual(before);
  });
  it.each([
    { adults: 0 }, { adults: -1 }, { adults: 1.5 }, { adults: NaN }, { adults: Infinity }, { adults: Number.MAX_SAFE_INTEGER + 1 },
    { adults: 2, composition: ["solo"] }, { children: [{}], composition: ["solo"] }, { children: [{ age: -1 }] },
    { children: [{ age: 1.5 }] }, { children: [{ age: Infinity }] }, { children: [{ ageGroup: "unknown" }] },
    { children: [null] }, { children: [{ birthDate: "2020-01-01" }] }, { childrenCount: 2 }, { email: "private" },
    { composition: ["invented"] }, { composition: ["friends", "friends"] }, { source: "profile" },
  ])("rejects invalid/extra/personal fields: %j", (fields) => {
    expect(() => validateTripParty({ ...base, ...fields } as TripParty)).toThrow();
  });
  it("requires reciprocal non-rejected party source links", () => {
    const request = partyRequest();
    expect(() => requestTrip(request)).not.toThrow();
    expect(() => requestTrip({ ...request, assumptions: [] })).toThrow();
    expect(() => requestTrip({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, source: "profile" })) })).toThrow();
    expect(() => requestTrip({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, affects: [] })) })).toThrow();
    expect(() => requestTrip({ ...request, assumptions: request.assumptions.map((a) => ({ ...a, status: "rejected" })) })).toThrow();
    expect(() => requestTrip({ ...request, party: undefined, assumptions: request.assumptions.map((a) => ({ ...a, status: "confirmed" })) })).toThrow();
  });
  it("cannot disguise a rejected value as user party, reorder keys, or confirm a changed party", () => {
    const trip = requestTrip(partyRequest()), before = structuredClone(trip);
    for (const status of ["rejected", "confirmed"] as const) {
      const request = { ...trip.request, party: status === "rejected"
        ? { ...trip.request.party!, source: "user" as const, assumptionId: undefined }
        : { ...trip.request.party!, adults: 3 }, assumptions: trip.request.assumptions.map((a) => ({ ...a, status })) };
      expect(() => applyTripProposal(trip, { tripId: trip.id, baseRevision: trip.revision, summary: "不正", patches: [{ type: "request", request }] })).toThrow();
    }
    expect(trip).toEqual(before);
  });
});
