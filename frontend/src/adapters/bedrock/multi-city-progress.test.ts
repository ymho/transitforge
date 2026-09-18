// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { multiCityTrip, resolvedPlace } from "../../../../modules/trip/domain/trip-places.fixture";
import { askProgressFixture, modelAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { resolveAssistantMessage } from "../../presentation/concierge/ai-guide-panel";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";

it("reuses the known-requirement policy for multi-city requests and delivers progress without writing Trip", async () => {
  const f = askProgressFixture("C-candidate"), base = multiCityTrip();
  const trip = { ...base, request: { constraints: [{ id: "cities", source: "user" as const, strength: "soft" as const, scope: { type: "trip" as const },
    requirement: { type: "destinations" as const, order: "fixed" as const, places: ["Vienna", "Salzburg", "Zürich"].map((p) => resolvedPlace(p)) } }], assumptions: [] } };
  const before = structuredClone(trip); let calls = 0, observation: AgentTurnObservation | undefined, context = "";
  const scripts = [
    modelTools(modelTool("ask_follow_up", { question: "目的地はどこですか", expectedInput: "free-text", requestedRequirement: "destinations" })),
    modelTools(modelTool("propose_manual_activity", { itemId: "free", operation: "add", title: "自由時間", category: "free-time", schedule: { type: "unscheduled" } })),
  ];
  const response = await runViewerAgentRuntime("今の旅の最後に自由時間を追加して", { ...f.base, getCurrentTrip: () => trip, onTurnObservation: (o) => { observation = o; } }, async (messages) => {
    if (!context) context = JSON.stringify(messages);
    return scripts[calls++] ?? modelAnswer("自由時間を追加する案です。");
  });
  expect(calls).toBe(3); // rejected known-condition question -> proposal -> final response
  for (const name of ["Vienna", "Salzburg", "Zürich", "itineraryPlaces", "overnightPlaces", "persistedTripRequest"]) expect(context).toContain(name);
  expect(observation?.outcome).toBe("progress"); expect(observation?.progress).toContainEqual({ kind: "itinerary", refs: ["free"] });
  if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("No progress proposal");
  const preview = applyTripProposal(trip, response.tripUpdateProposal);
  expect(preview.items.slice(0, 3)).toEqual(trip.items); expect(trip).toEqual(before);
  const li = document.createElement("li"); li.scrollIntoView = vi.fn(); const writer = vi.fn();
  resolveAssistantMessage(li, response, undefined, writer, undefined, undefined, undefined, undefined, false);
  expect(li.textContent).toContain("自由時間"); expect(li.textContent).not.toContain("目的地はどこ");
  expect(writer).not.toHaveBeenCalled(); expect(li.querySelector(".trip-plan-update-apply")).toBeNull();
});
