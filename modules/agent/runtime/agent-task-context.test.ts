import { describe, expect, it } from "vitest";
import { deriveAgentTaskContext } from "./agent-task-context";
const id = "22222222-2222-4222-8222-222222222222";
describe("AgentTaskContext", () => {
  it("keeps an existing Trip in discovery until there is an itinerary draft", () => {
    for (const planningState of ["inspiration", "candidate_discovery", "candidate_selection"]) {
      expect(deriveAgentTaskContext({ trip: { id, revision: 3, planningState } })).toMatchObject({ phase: "discovery", target: { kind: "trip", tripId: id, tripRevision: 3 } });
    }
    expect(deriveAgentTaskContext({ trip: { id, planningState: "itinerary_draft" } }).phase).toBe("draft");
    expect(deriveAgentTaskContext({ trip: { id, planningState: "itinerary_refinement" } }).phase).toBe("refine");
    expect(deriveAgentTaskContext({ trip: { id, planningState: "ready", lifecycleState: "in_trip" } }).phase).toBe("in_trip");
  });
  it("keeps internal request-less discovery independent from arbitrary wording", () => {
    expect(deriveAgentTaskContext({ conversationId: id }).phase).toBe("discovery");
    expect(deriveAgentTaskContext({ trip: { id, planningState: "inspiration", title: "10/1から2泊3日" } }).phase).toBe("discovery");
  });
});
