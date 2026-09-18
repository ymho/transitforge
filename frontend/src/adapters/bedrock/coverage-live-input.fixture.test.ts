import { describe, expect, it } from "vitest";
import { coverageLiveInputs } from "./coverage-live-input.fixture";
import { askProgressFixture } from "./ask-progress-scenarios.fixture";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { assessTravelCandidate } from "@raiquora/trip/assess-travel-candidate";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";

describe("coverage Live input integrity", () => {
  it("known-condition case has evidence for every asserted hard condition", () => {
    const input = coverageLiveInputs(), rail = railSelectionFixture();
    const trip = { ...askProgressFixture("C-candidate").trip, request: input.request };
    const candidate = createTravelCandidate({ id: rail.candidate.candidateId, journey: rail.candidate.journey });
    const evaluate = (facts: typeof input.facts) => assessTravelCandidate(trip, candidate, {
      candidateId: candidate.id, ...facts, rail: { candidate: rail.candidate, inputs: rail.inputs },
    }, rail.selectedAt);
    expect(evaluate(input.facts).hardConstraints.map((c) => c.status)).toEqual(["satisfied", "satisfied"]);
    expect(evaluate({}).hardConstraints.every((c) => c.status === "unknown")).toBe(true);
    const unresolved = structuredClone(input.facts);
    if (unresolved.places?.data?.origin) delete unresolved.places.data.origin.ref;
    expect(evaluate(unresolved).hardConstraints.find((c) => c.constraintId === "origin")?.status).toBe("unknown");
  });
});
