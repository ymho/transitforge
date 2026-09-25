import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { DynamoDbConversationTurnRepository } from "../../adapters/dynamodb-conversation-turn-repository.js";
import { conversationId, stateA as principal, stateDynamoFixture, stateMetadata } from "../../adapters/state-dynamodb.fixture.js";
import { createConversationTurnApplication } from "./conversation-turn.js";
import { semanticMultiTurnExpected } from "./semantic-multi-turn-expected.fixture.js";
import { semanticMultiTurnInputs } from "./semantic-multi-turn-inputs.fixture.js";
import { semanticMultiTurnProviderFixture } from "./semantic-multi-turn-provider.fixture.js";

const success = { status: "completed", response: "案内" } as unknown as AgentRuntimeResult;

describe("production-shaped semantic multi-turn corpus", () => {
  it("runs 30 separated scenarios through the Server conversation Application", async () => {
    expect(semanticMultiTurnInputs).toHaveLength(30); expect(semanticMultiTurnExpected).toHaveLength(30);
    expect(new Set(semanticMultiTurnInputs.map(({ scenarioId }) => scenarioId)))
      .toEqual(new Set(semanticMultiTurnExpected.map(({ scenarioId }) => scenarioId)));
    expect(semanticMultiTurnInputs.every((scenario) => Object.keys(scenario).every((key) =>
      ["scenarioId", "category", "calendarDate", "turns"].includes(key)))).toBe(true);
    expect(new Set(semanticMultiTurnInputs.flatMap(({ turns }) => turns)).size).toBe(60);
    const gold = new Map(semanticMultiTurnExpected.map((item) => [item.scenarioId, item]));

    for (const [scenarioIndex, scenario] of semanticMultiTurnInputs.entries()) {
      const f = stateDynamoFixture(); await f.conversations.create(principal, conversationId, stateMetadata());
      const turns = new DynamoDbConversationTurnRepository("test-state", f.client, f.clock);
      const runAgentTurn = vi.fn<Parameters<typeof createConversationTurnApplication>[0]["runAgentTurn"]>(async () => success);
      const app = createConversationTurnApplication({ turns, runAgentTurn,
        interpretIntent: async ({ userRequest }) => semanticMultiTurnProviderFixture(userRequest) });

      for (const [turnIndex, userRequest] of scenario.turns.entries()) await app.runConversationTurn({ principal, conversationId,
        turnId: `00000000-0000-4000-8000-${String(1000 + scenarioIndex * 10 + turnIndex).padStart(12, "0")}`, userRequest,
        uiContext: { calendarDate: scenario.calendarDate } });

      const overlay = (await turns.getWorkingState(principal, conversationId))!.semantic!.overlay;
      const expected = gold.get(scenario.scenarioId)!;
      expect(overlay.intentRevision, scenario.scenarioId).toBe(expected.expectedIntentRevision);
      expect(overlay.facts, scenario.scenarioId).toHaveLength(expected.facts.length);
      for (const fact of expected.facts) expect(overlay.facts, scenario.scenarioId).toEqual(expect.arrayContaining([expect.objectContaining({
        target: fact.target, frame: fact.frame, ...(fact.modality ? { modality: fact.modality } : {}),
        ...(fact.scopeKind ? { scope: expect.objectContaining({ type: fact.scopeKind }) } : {}),
        value: expect.objectContaining({ ...(fact.kind ? { kind: fact.kind } : {}), ...(fact.text ? { text: fact.text } : {}), ...(fact.label ? { label: fact.label } : {}),
          ...(fact.amount !== undefined ? { amount: fact.amount } : {}) }),
      })]));
      if (expected.tombstoneTarget) expect(overlay.tombstones).toEqual(expect.arrayContaining([expect.objectContaining({ target: expected.tombstoneTarget })]));
      expect(runAgentTurn).toHaveBeenCalledTimes(scenario.turns.length);
      expect(runAgentTurn.mock.calls.every(([runtimeInput]) => !("expected" in runtimeInput))).toBe(true);
    }
  });
});
