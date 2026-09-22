import { describe, expect, it } from "vitest";
import { deriveAgentTaskContext } from "./agent-task-context";

describe("AgentTaskContext", () => {
  it("derives discovery, draft, refine and in-trip without legacy planningStage", () => {
    expect(deriveAgentTaskContext({ conversationId: "11111111-1111-4111-8111-111111111111" }).phase).toBe("discovery");
    expect(deriveAgentTaskContext({ consultationRequest: { constraints: [] }, requestRevision: 7 }))
      .toMatchObject({ phase: "draft", requestRevision: 7 });
    expect(deriveAgentTaskContext({ trip: { id: "22222222-2222-4222-8222-222222222222", revision: 3, planningState: "candidate_selection" } }))
      .toMatchObject({ phase: "refine", target: { kind: "trip", tripRevision: 3 } });
    expect(deriveAgentTaskContext({ trip: { id: "22222222-2222-4222-8222-222222222222", lifecycleState: "in_trip" } }).phase).toBe("in_trip");
  });
});
