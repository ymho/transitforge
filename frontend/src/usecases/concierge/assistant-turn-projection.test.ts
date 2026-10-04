import { describe, expect, it } from "vitest";
import { projectAssistantTurn } from "./assistant-turn-projection";

describe("assistant turn projection", () => {
  it("uses the same object shape for a text-only live reply and restored history", () => {
    const live = projectAssistantTurn({ response: "自由に相談してください" });
    const saved = { role: "assistant", text: "自由に相談してください", sequence: 2 };
    expect(projectAssistantTurn({ response: saved.text, ...saved })).toEqual(live);
    expect(live).toEqual({ text: "自由に相談してください" });
  });
  it("omits legacy display state and private fields even when a caller supplies them", () => {
    const turn = { response: "候補を比較できます", delivery: { status: "partial" as const, basis: "model" as const },
      publicAccommodationPresentation: { version: "public-accommodation-presentation-v1" as const, cards: [2, 1].map(id => ({
        evidenceId: `hotel-${id}`, name: `宿${id}`, summary: "空室未確認", sourceUrl: `https://example.org/${id}`, retrievedAt: "2026-10-04T00:00:00Z",
      })) },
      conversation: { quickReplies: [{ label: "old", value: "old" }] }, tripContext: { goal: "old" },
      external: { provider: "private-provider" }, checklistProposal: { private: true }, progressSources: ["private"], trace: "private" };
    expect(projectAssistantTurn(turn)).toEqual({ text: turn.response, delivery: turn.delivery,
      publicAccommodationPresentation: turn.publicAccommodationPresentation });
    expect(projectAssistantTurn(turn).publicAccommodationPresentation?.cards.map(card => card.evidenceId)).toEqual(["hotel-2", "hotel-1"]);
  });
  it("preserves the same save read-back in live and history projection without a write callback", () => {
    const tripMutationReceipt = { version: "public-trip-mutation-receipt-v1" as const, tripId: "11111111-1111-4111-8111-111111111111", tripRevision: 4 };
    expect(projectAssistantTurn({ response: "保存しました", tripMutationReceipt })).toEqual({ text: "保存しました", tripMutationReceipt });
  });
  it("keeps multiple public artifacts on the same turn", () => {
    const publicJourneyPresentation = { version: "public-journey-presentation-v1" as const, presentationId: "p", serviceDate: "2026-09-24", originStation: "A", destinationStation: "B", evidenceRefs: ["e"], journeys: [{ id: "j", departureTime: "08:00", arrivalTime: "09:00", durationMinutes: 60, transferCount: 0, legs: [{ originStation: "A", destinationStation: "B", departureTime: "08:00", arrivalTime: "09:00", serviceUid: "s", trainNumber: "1", serviceType: "普通", trainName: "普通" }] }] };
    const tripUpdateProposal = { tripId: "11111111-1111-4111-8111-111111111111", baseRevision: 0, summary: "案", patches: [] };
    expect(projectAssistantTurn({ response: "回答", publicJourneyPresentation, tripUpdateProposal })).toEqual({ text: "回答", publicJourneyPresentation, tripUpdateProposal });
  });
});
