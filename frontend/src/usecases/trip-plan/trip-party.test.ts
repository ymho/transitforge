import { describe, it, expect } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { partyRequest } from "../../../../modules/trip/domain/trip-party.fixture";
import { requestTrip } from "../../../../modules/trip/domain/trip-request.fixture";
import { proposeAssumptionDecision, proposeUserParty, proposeProfileParty, proposeTripRequestUpdate } from "./update-trip-request";
import { tripPartyView } from "./trip-party-presentation";
import { planAssumptionViews } from "../../presentation/trip-plan/plan-assumption-view";

describe("party proposal ownership and atomic assumption decisions", () => {
  it.each(["model", "profile", "legacy"] as const)("confirms same values and retains source: %s", (source) => {
    const trip = requestTrip(partyRequest(source)), before = structuredClone(trip);
    expect(tripPartyView(trip)?.text).toBe("⚠ 仮置き: 大人2人 + 子ども1人（年齢未確認）");
    expect(planAssumptionViews(trip)[0]?.actions.map((a) => a.status)).toEqual(["confirmed", "rejected"]);
    const confirmed = applyTripProposal(trip, proposeAssumptionDecision(trip, "party", "confirmed"));
    expect(confirmed.request.party).toEqual(trip.request.party);
    expect(tripPartyView(confirmed)?.text).not.toContain("仮置き");
    expect(applyTripProposal(confirmed, proposeAssumptionDecision(confirmed, "party", "confirmed"))).toEqual(confirmed);
    expect(() => proposeAssumptionDecision(confirmed, "party", "rejected")).toThrow();
    expect(trip).toEqual(before);
  });
  it.each(["remove", "replace"] as const)("requires %s atomically and retries cannot replace again", (type) => {
    const trip = requestTrip(partyRequest()), before = structuredClone(trip);
    const repair = type === "remove" ? { type } : { type, party: { adults: 2, children: [], composition: ["friends" as const], source: "user" as const } };
    expect(() => proposeAssumptionDecision(trip, "party", "rejected")).toThrow();
    const next = applyTripProposal(trip, proposeAssumptionDecision(trip, "party", "rejected", [], repair));
    expect(next.request.party).toEqual(type === "replace" ? repair.party : undefined);
    expect(next.request.assumptions[0]?.status).toBe("rejected");
    expect(applyTripProposal(next, proposeAssumptionDecision(next, "party", "rejected", [], repair))).toEqual(next);
    expect(() => proposeAssumptionDecision(next, "party", "rejected", [], { type: "replace", party: { adults: 3, children: [], source: "user" } })).toThrow();
    expect(trip).toEqual(before);
  });
  it("model proposals cannot overwrite known party or label new party as confirmed/user", () => {
    const empty = requestTrip(), request = partyRequest();
    expect(applyTripProposal(empty, proposeTripRequestUpdate(empty, request, "model")).request).toEqual(request);
    for (const party of [{ ...request.party!, source: "user" as const, assumptionId: undefined }, { ...request.party!, source: "profile" as const }]) {
      expect(() => proposeTripRequestUpdate(empty, { ...request, party }, "model")).toThrow();
    }
    const known = requestTrip(request);
    expect(() => proposeTripRequestUpdate(known, { ...request, party: undefined }, "model")).toThrow();
    expect(() => proposeTripRequestUpdate(known, { ...request, party: { ...request.party!, adults: 5 } }, "model")).toThrow();
  });
  it("keeps profile tendencies separate; explicit friends supersede family without profile mutation", () => {
    const profile = { companions: { usual: ["family"], children: [{ ageGroup: "preschool" }] } } as UserProfile;
    const original = structuredClone(profile), trip = requestTrip();
    expect(trip.request.party).toBeUndefined();
    const next = applyTripProposal(trip, proposeProfileParty(trip, profile, 2, "family"));
    expect(next.request.party).toMatchObject({ adults: 2, children: [{ ageGroup: "preschool" }], source: "profile", assumptionId: "family" });
    expect(next.request.assumptions[0]).toMatchObject({ status: "unconfirmed", source: "profile" });
    const explicit = applyTripProposal(next, proposeUserParty(next, { adults: 2, children: [], composition: ["friends"] }));
    expect(explicit.request.party).toEqual({ adults: 2, children: [], composition: ["friends"], source: "user" });
    expect(() => proposeProfileParty(explicit, profile, 2, "another")).toThrow();
    expect(profile).toEqual(original);
  });
  it("invalid replacement or unrelated repair leaves original unchanged", () => {
    const trip = requestTrip(partyRequest()), before = structuredClone(trip);
    expect(() => proposeAssumptionDecision(trip, "party", "rejected", [], { type: "replace", party: { adults: 0, children: [], source: "user" } })).toThrow();
    expect(() => proposeAssumptionDecision(trip, "party", "confirmed", [], { type: "remove" })).toThrow();
    expect(trip).toEqual(before);
  });
});
