import { describe, expect, it } from "vitest";
import { projectAssistantTurn } from "./assistant-turn-projection";

describe("assistant turn projection", () => {
  it("keeps multiple public artifacts on the same turn", () => {
    const publicJourneyPresentation = { version: "public-journey-presentation-v1" as const, presentationId: "p", serviceDate: "2026-09-24", originStation: "A", destinationStation: "B", evidenceRefs: ["e"], journeys: [{ id: "j", departureTime: "08:00", arrivalTime: "09:00", durationMinutes: 60, transferCount: 0, legs: [{ originStation: "A", destinationStation: "B", departureTime: "08:00", arrivalTime: "09:00", serviceUid: "s", trainNumber: "1", serviceType: "普通", trainName: "普通" }] }] };
    const tripUpdateProposal = { tripId: "11111111-1111-4111-8111-111111111111", baseRevision: 0, summary: "案", patches: [] };
    expect(projectAssistantTurn({ response: "回答", publicJourneyPresentation, tripUpdateProposal })).toEqual({ text: "回答", publicJourneyPresentation, tripUpdateProposal });
  });
});
