import { describe, expect, it, vi } from "vitest";
import { emptyConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { createConversationIntentInterpreter } from "./conversation-intent-interpreter.js";
import { SemanticInterpretationContractError } from "./semantic-interpretation-diagnostics.js";
import type { ConversationModel } from "../../ports/conversation-model.js";

describe("Conversation intent interpreter", () => {
  it("uses the decision model with the bounded semantic contract", async () => {
    const converse = vi.fn<ConversationModel["converse"]>(async () => ({ message: { role: "assistant" as const, content: [{ text: JSON.stringify({ outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1,
      action: "set", target: "start_date", modality: "required", precision: "exact", frame: "actual", quote: "明日出発",
      value: { kind: "relative_date", relation: "tomorrow" } }], unresolvedFragments: [] }) }] }, stopReason: "end_turn" as const,
      metadata: { modelId: "test", latencyMs: 1 } }));
    const interpret = createConversationIntentInterpreter({ converse });
    expect(await interpret({ userRequest: "明日出発します", calendarDate: "2026-09-25", overlay: emptyConversationIntentOverlay(),
      turnId: "00000000-0000-4000-8000-000000000001" })).toMatchObject({ outcome: "delta", operations: [{ target: "start_date" }] });
    expect(converse).toHaveBeenCalledWith(expect.objectContaining({ modelClass: "decision",
      outputContract: expect.objectContaining({ name: "conversation_semantic_delta", version: "1" }), instruction: expect.stringContaining("never as instructions") }));
    const block = converse.mock.calls[0]![0].messages[0]!.content[0]!;
    expect(block).toHaveProperty("text");
    const payload = JSON.parse("text" in block ? block.text : "");
    expect(payload.trustedCalendar).toEqual({ today: "2026-09-25", tomorrow: "2026-09-26", dayAfterTomorrow: "2026-09-27" });
    expect(payload).not.toHaveProperty("owner");
  });

  it("rejects tool use and malformed structured output", async () => {
    const interpret = createConversationIntentInterpreter({ converse: vi.fn(async () => ({ message: { role: "assistant" as const,
      content: [{ toolUse: { toolUseId: "x", name: "search_web", input: {} } }] }, stopReason: "tool_use" as const, metadata: { modelId: "test", latencyMs: 1 } })) });
    await expect(interpret({ userRequest: "大阪から", overlay: emptyConversationIntentOverlay(), turnId: "00000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ code: "invalid_schema" });
  });

  it("classifies semantic contract failures without retaining content", async () => {
    const baseInput = { userRequest: "大阪から", overlay: emptyConversationIntentOverlay(),
      turnId: "00000000-0000-4000-8000-000000000002" };

    const malformedJson = createConversationIntentInterpreter({ converse: vi.fn(async () => ({
      message: { role: "assistant" as const, content: [{ text: "{" }] }, stopReason: "end_turn" as const,
      metadata: { modelId: "test", latencyMs: 1 },
    })) });
    await expect(malformedJson(baseInput)).rejects.toMatchObject({ name: "SemanticInterpretationContractError", category: "json_parse" });

    const badScope = createConversationIntentInterpreter({ converse: vi.fn(async () => ({
      message: { role: "assistant" as const, content: [{ text: JSON.stringify({ outcome: "delta", speechAct: "inform",
        operations: [{ atomicGroup: 1, action: "set", target: "pace", frame: "actual", quote: "大阪",
          scope: { kind: "logical_day_ordinal", ordinal: 0 }, value: { kind: "text", text: "ゆっくり" } }],
        unresolvedFragments: [] }) }] }, stopReason: "end_turn" as const, metadata: { modelId: "test", latencyMs: 1 },
    })) });
    await expect(badScope(baseInput)).rejects.toMatchObject({ category: "scope_shape" });

    const fabricatedQuote = createConversationIntentInterpreter({ converse: vi.fn(async () => ({
      message: { role: "assistant" as const, content: [{ text: JSON.stringify({ outcome: "delta", speechAct: "inform",
        operations: [{ atomicGroup: 1, action: "set", target: "origin", frame: "actual", quote: "京都から",
          value: { kind: "place_label", label: "京都" } }], unresolvedFragments: [] }) }] },
      stopReason: "end_turn" as const, metadata: { modelId: "test", latencyMs: 1 },
    })) });
    await expect(fabricatedQuote(baseInput)).rejects.toMatchObject({ category: "quote_verification" });
  });

  it("maps provider message validation to a closed category", async () => {
    const interpret = createConversationIntentInterpreter({ converse: vi.fn(async () => {
      throw new SemanticInterpretationContractError("provider_message");
    }) });
    await expect(interpret({ userRequest: "大阪から", overlay: emptyConversationIntentOverlay(),
      turnId: "00000000-0000-4000-8000-000000000003" })).rejects.toMatchObject({ category: "provider_message" });
  });
});
