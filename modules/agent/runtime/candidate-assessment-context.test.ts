import { describe, expect, it } from "vitest";
import { candidateIdentityContext } from "@raiquora/agent/candidate-assessment-context";
import { railSelectionFixture } from "../../trip/domain/selected-rail-journey.fixture";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";

describe("candidate identity for coverage decisions", () => {
  it("retains already known endpoints without promoting times, observations or private offerings", () => {
    const fixture = railSelectionFixture();
    const candidate = createTravelCandidate({ id: "known", journey: fixture.candidate.journey,
      accommodations: [{ kind: "accommodation", provider: "example", providerItemId: "private-provider-id", name: "宿の候補", checkInDate: "2026-09-13", checkOutDate: "2026-09-14", bookingUrl: "https://example.test/private" }] });
    const projection = candidateIdentityContext(candidate);
    expect(projection).toEqual({ id: "known", originStation: "A", destinationStation: "C", names: ["宿の候補"] });
    expect(JSON.stringify(projection)).not.toMatch(/private|Minutes|journey|booking/);
  });
  it("does not invent unknown endpoints for discovery candidates", () => {
    expect(candidateIdentityContext({ id: "discovery" })).toEqual({ id: "discovery", names: [] });
  });
});
