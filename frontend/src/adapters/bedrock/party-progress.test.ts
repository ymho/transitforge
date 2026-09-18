import { describe, it, expect } from "vitest";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { askProgressFixture, modelTool, modelTools, modelAnswer } from "./ask-progress-scenarios.fixture";
import { applyTripProposal } from "@raiquora/trip/trip";
import { partyRequest } from "../../../../modules/trip/domain/trip-party.fixture";
import { tripPartyProviderInput } from "../http/trip-party-input";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";

const manual = { itemId: "break", operation: "add", title: "自由時間", category: "free-time", schedule: { type: "unscheduled" } };
describe("party with the existing production Ask + Progress boundary", () => {
  it("proposes unknown-age party through the same request tool and shows a provisional itinerary", async () => {
    const f = askProgressFixture("C-candidate"), request = { ...partyRequest(), constraints: f.trip.request.constraints };
    let calls = 0; let observation: AgentTurnObservation | undefined;
    const response = await runViewerAgentRuntime("人数は大人2人、子ども1人で仮置きして", { ...f.base, onTurnObservation: (o) => { observation = o; } }, async () => {
      if (calls++ === 0) return modelTools(modelTool("propose_request_assumptions", { request }));
      if (calls === 2) return modelTools(modelTool("propose_manual_activity", manual), modelTool("ask_follow_up", { question: "自由時間は散歩と休憩、どちらがよさそうですか", expectedInput: "free-text" }));
      return modelAnswer("仮旅程を提案します。");
    });
    expect(observation?.outcome).toBe("ask_and_progress");
    if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("Missing proposal");
    const preview = applyTripProposal(f.trip, response.tripUpdateProposal);
    expect(preview.request.party).toEqual(request.party);
    expect(response.text).toContain("⚠ 仮置き: 大人2人 + 子ども1人（年齢未確認）");
    expect(f.trip.request.party).toBeUndefined();
  });
  it("asks unknown ages with progress only at the specific operation requiring them", async () => {
    const f = askProgressFixture("C-candidate");
    const trip = { ...f.trip, request: { ...f.trip.request, party: { adults: 2, children: [{}], source: "user" as const } } };
    const before = structuredClone(trip);
    expect(tripPartyProviderInput(trip.request.party, { toolName: "discovery", requiresExactChildAges: false }).ok).toBe(true);
    const missing = tripPartyProviderInput(trip.request.party, { toolName: "hotel_availability", requiresExactChildAges: true });
    if (missing.ok) throw new Error("Expected missing child age");
    let calls = 0; let observation: AgentTurnObservation | undefined;
    const response = await runViewerAgentRuntime("宿の具体的な候補も検討したい", { ...f.base, getCurrentTrip: () => trip, onTurnObservation: (o) => { observation = o; } },
      async () => calls++ === 0 ? modelTools(modelTool("propose_manual_activity", manual), modelTool("ask_follow_up", {
        question: `${missing.missing[0]!.missingFact}を教えてください。旅程の案は先に提示します。`, expectedInput: "free-text", requestedRequirement: "child-age",
      })) : modelAnswer("年齢を捏造せず、予約検索は未完了です。"));
    expect(observation?.outcome).toBe("ask_and_progress");
    expect(typeof response !== "string" && "tripUpdateProposal" in response).toBe(true);
    expect(trip).toEqual(before);
  });
  it("rejects questions about confirmed party and already known exact ages", async () => {
    const f = askProgressFixture("C-candidate");
    const trip = { ...f.trip, request: { ...partyRequest(), constraints: f.trip.request.constraints,
      party: { ...partyRequest().party!, children: [{ age: 7 }] }, assumptions: partyRequest().assumptions.map((a) => ({ ...a, status: "confirmed" as const })) } };
    for (const requestedRequirement of ["party", "child-age"]) {
      let calls = 0; let observation: AgentTurnObservation | undefined;
      const response = await runViewerAgentRuntime("仮旅程をください", { ...f.base, getCurrentTrip: () => trip, onTurnObservation: (o) => { observation = o; } }, async () => {
        if (calls++ === 0) return modelTools(modelTool("ask_follow_up", { question: "既知の条件を教えて", expectedInput: "free-text", requestedRequirement }));
        if (calls === 2) return modelTools(modelTool("propose_manual_activity", manual));
        return modelAnswer("既知の条件を使います。");
      });
      expect(observation?.outcome).toBe("progress");
      expect(typeof response !== "string" && response.text.includes("既知の条件を教えて")).toBe(false);
    }
  });
});
