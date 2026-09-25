import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { asksForKnownIntent } from "@raiquora/agent/intent-action-policy";
import type { UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";
import { ConversationApplication } from "../conversation-application.js";
import { ProfileApplication } from "../profile-application.js";
import { DynamoDbConversationTurnRepository } from "../../adapters/dynamodb-conversation-turn-repository.js";
import { conversationId, noCandidateResources, stateA as principal, stateDynamoFixture, stateMetadata, stateProfile } from "../../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../../adapters/trip-dynamodb.fixture.js";
import { createConversationTurnApplication } from "./conversation-turn.js";
import { createServerStateContextLoader } from "./server-state-context-loader.js";

const completed = { status: "completed", response: "案内" } as unknown as AgentRuntimeResult;
const noChange = (speechAct: "inform" | "question" = "inform"): UtteranceInterpretation =>
  ({ outcome: "no_change", speechAct, operations: [], unresolvedFragments: [] });

describe("complex semantic acceptance matrix", () => {
  it("keeps latest presentation, explicit unknown, retry and later turns coherent beyond 12 messages", async () => {
    const state = stateDynamoFixture();
    const { tripId: _tripId, ...metadata } = stateMetadata();
    await state.conversations.create(principal, conversationId, metadata);
    const profiles = new ProfileApplication(state.profiles, state.clock);
    await profiles.update(principal, { ...stateProfile(), home: { station: "京都駅" } }, null);
    const turns = new DynamoDbConversationTurnRepository("test-state", state.client, state.clock);
    const interpretations = new Map<string, UtteranceInterpretation>([
      ["候補を見せて", noChange()],
      ["候補を並べ替えて", noChange()],
      ["2番目で", delta("confirm", operation("2番目", "candidate_selection", { kind: "presentation_ordinal", ordinal: 2 }))],
      ["出発地は未定です", delta("inform", operation("出発地は未定", "origin", { kind: "unknown", reason: "undecided" }))],
      ["食事重視", delta("inform", operation("食事", "experience", { kind: "text", text: "食事" }))],
      ["歴史も追加", delta("inform", { ...operation("歴史", "experience", { kind: "text", text: "歴史" }), action: "add_alternative" })],
      ["この地域の特徴は？", noChange("question")],
    ]);
    const interpretIntent = vi.fn(async ({ userRequest }: { userRequest: string }) => structuredClone(interpretations.get(userRequest)!));
    let failFoodAnswerOnce = true;
    const runAgentTurn = vi.fn(async ({ userRequest }: { userRequest: string }) => {
      if (userRequest === "食事重視" && failFoodAnswerOnce) { failFoodAnswerOnce = false; throw new Error("provider unavailable"); }
      if (userRequest === "候補を見せて") return { ...completed,
        turnObservation: { outcome: "progress" as const, progress: [{ kind: "candidates" as const, refs: ["candidate:a", "candidate:b"] }] } };
      if (userRequest === "候補を並べ替えて") return { ...completed,
        turnObservation: { outcome: "progress" as const, progress: [{ kind: "candidates" as const, refs: ["candidate:b", "candidate:a"] }] } };
      return completed;
    });
    const app = createConversationTurnApplication({ turns, runAgentTurn, interpretIntent });
    const run = (index: number, userRequest: string) => app.runConversationTurn({ principal, conversationId,
      turnId: `00000000-0000-4000-8000-${String(3000 + index).padStart(12, "0")}`, userRequest });

    await run(1, "候補を見せて");
    await run(2, "候補を並べ替えて");
    await run(3, "2番目で");
    await run(4, "出発地は未定です");
    await expect(run(5, "食事重視")).rejects.toMatchObject({ code: "unavailable" });
    await run(5, "食事重視");
    await run(6, "歴史も追加");
    await run(7, "この地域の特徴は？");

    const working = (await turns.getWorkingState(principal, conversationId))!;
    expect(working.semantic?.overlay.intentRevision).toBe(4);
    expect(working.semantic?.overlay.facts.find(({ target }) => target === "candidate_selection")?.value)
      .toMatchObject({ kind: "candidate_ref", candidateRef: "candidate:a", presentationId: "00000000-0000-4000-8000-000000003002" });
    expect(working.semantic?.overlay.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "origin", value: { kind: "unknown", reason: "undecided" } }),
      expect.objectContaining({ target: "experience", value: { kind: "text", text: "食事" } }),
      expect.objectContaining({ target: "experience", value: { kind: "text", text: "歴史" } }),
    ]));
    expect(interpretIntent).toHaveBeenCalledTimes(7);
    expect(runAgentTurn).toHaveBeenCalledTimes(8);
    expect((await state.conversations.history(principal, conversationId)).items.length).toBeGreaterThan(12);

    const conversations = new ConversationApplication(state.conversations, noCandidateResources, () => conversationId);
    const context = await createServerStateContextLoader({ conversations, profiles, trips: tripDynamoFixture().repository, workingStates: turns })
      ({ principal, conversationId });
    expect(context.effectiveIntent?.actualConversationFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "origin", value: expect.objectContaining({ kind: "unknown" }) }),
    ]));
    expect(context.effectiveIntent?.profileHints.some(({ target }) => target === "origin")).toBe(false);
    expect(asksForKnownIntent({ interpretedGoal: "旅の相談", hardConstraints: [], softPreferences: [], selectedAction: "ask_user",
      unresolvedFacts: ["origin"], reasonCodes: ["user_confirmation_required"],
      missingRequirements: [{ action: "ask", field: "origin", resolution: "user_decision", reason: "検索のため" }] }, context.effectiveIntent)).toBe(true);
  });
});

function operation(quote: string, target: "candidate_selection" | "origin" | "experience",
  value: NonNullable<UtteranceInterpretation["operations"][number]["value"]>): UtteranceInterpretation["operations"][number] {
  return { atomicGroup: 1, action: "set", target, modality: "preferred", precision: "qualitative", frame: "actual", quote, value };
}

function delta(speechAct: "inform" | "confirm", operationValue: UtteranceInterpretation["operations"][number]): UtteranceInterpretation {
  return { outcome: "delta", speechAct, operations: [operationValue], unresolvedFragments: [] };
}
