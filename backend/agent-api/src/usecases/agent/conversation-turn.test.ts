import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { stateDynamoFixture, stateA as principal, conversationId, secondId, stateMetadata } from "../../adapters/state-dynamodb.fixture.js";
import { DynamoDbConversationTurnRepository } from "../../adapters/dynamodb-conversation-turn-repository.js";
import { createConversationTurnApplication } from "./conversation-turn.js";
import type { UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";

const input = { principal, conversationId, turnId: secondId, userRequest: "旅の相談" };
const success = { status: "completed", response: "案内", trace: { secret: "private" }, evidence: [{ raw: "private" }] } as unknown as AgentRuntimeResult;
async function setup() {
  const f = stateDynamoFixture(); await f.conversations.create(principal, conversationId, stateMetadata());
  const turns = new DynamoDbConversationTurnRepository("test-state", f.client, f.clock);
  const runAgentTurn = vi.fn<Parameters<typeof createConversationTurnApplication>[0]["runAgentTurn"]>(async () => success);
  return { ...f, turns, runAgentTurn, app: createConversationTurnApplication({ turns, runAgentTurn }) };
}
describe("Conversation turn Application", () => {
  it("interprets, accepts and exposes intent to Runtime before answer generation", async () => {
    const f = await setup();
    const interpretIntent = vi.fn(async () => ({ outcome: "delta" as const, speechAct: "inform" as const, operations: [{ atomicGroup: 1, action: "set" as const,
      target: "destination" as const, modality: "preferred" as const, precision: "exact" as const, frame: "actual" as const,
      quote: "旅", value: { kind: "place_label" as const, label: "出雲大社" } }], unresolvedFragments: [] }));
    f.runAgentTurn.mockImplementationOnce(async () => {
      expect(await f.turns.getWorkingState(principal, conversationId)).toMatchObject({ semantic: { overlay: { intentRevision: 1,
        facts: [{ target: "destination", value: { label: "出雲大社" } }] } } });
      return success;
    });
    const app = createConversationTurnApplication({ turns: f.turns, runAgentTurn: f.runAgentTurn, interpretIntent });
    const result = await app.runConversationTurn(input);
    expect(interpretIntent).toHaveBeenCalledOnce();
    const history = await f.conversations.history(principal, conversationId);
    expect(history.items.at(-1)?.semanticReceipt).toEqual(result.semanticReceipt);
  });

  it("keeps accepted intent when answer generation fails and does not reinterpret on retry", async () => {
    const f = await setup(), interpretIntent = vi.fn(async () => ({ outcome: "delta" as const, speechAct: "inform" as const, operations: [{ atomicGroup: 1,
      action: "set" as const, target: "destination" as const, modality: "preferred" as const, precision: "exact" as const,
      frame: "actual" as const, quote: "旅", value: { kind: "place_label" as const, label: "出雲大社" } }], unresolvedFragments: [] }));
    f.runAgentTurn.mockRejectedValueOnce(new Error("provider failed"));
    const app = createConversationTurnApplication({ turns: f.turns, runAgentTurn: f.runAgentTurn, interpretIntent });
    await expect(app.runConversationTurn(input)).rejects.toMatchObject({ code: "unavailable" });
    expect((await f.turns.getWorkingState(principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
    expect(await app.runConversationTurn(input)).toMatchObject({ status: "completed", response: "案内",
      semanticReceipt: { version: "public-semantic-receipt-v1", intentRevision: 1, outcome: "accepted" } });
    expect(interpretIntent).toHaveBeenCalledTimes(1);
  });
  it("publishes the same bounded receipt after acceptance and on accepted-intent retry", async () => {
    const f = await setup(), report = vi.fn(async () => {});
    const interpretIntent = vi.fn(async () => ({ outcome: "delta" as const, speechAct: "inform" as const, operations: [{ atomicGroup: 1,
      action: "set" as const, target: "destination" as const, modality: "preferred" as const, precision: "exact" as const,
      frame: "actual" as const, quote: "旅", value: { kind: "place_label" as const, label: "秘密の値" } }], unresolvedFragments: [] }));
    f.runAgentTurn.mockRejectedValueOnce(new Error("provider failed"));
    const app = createConversationTurnApplication({ turns: f.turns, runAgentTurn: f.runAgentTurn, interpretIntent });
    await expect(app.runConversationTurn(input, undefined, report)).rejects.toMatchObject({ code: "unavailable" });
    await app.runConversationTurn(input, undefined, report);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[0]).toEqual(report.mock.calls[1]);
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/秘密|quote|value|tripId/);
  });
  it("runs the S00 production-shaped semantic continuity fixtures without feeding expected state to Runtime", async () => {
    const f = await setup();
    f.runAgentTurn.mockImplementation(async ({ userRequest }) => userRequest === "出雲大社に行きたい"
      ? { ...success, turnObservation: { outcome: "progress", progress: [{ kind: "candidates", refs: ["candidate:izumo", "candidate:toyama"] }] } }
      : success);
    const interpretations = new Map<string, UtteranceInterpretation>([
      ["出雲大社に行きたい", { outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1, action: "set", target: "destination", modality: "preferred", precision: "exact", frame: "actual", quote: "出雲大社", value: { kind: "place_label", label: "出雲大社" } }], unresolvedFragments: [] }],
      ["明日出発", { outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1, action: "set", target: "start_date", modality: "required", precision: "exact", frame: "actual", quote: "明日", value: { kind: "relative_date", relation: "tomorrow" } }], unresolvedFragments: [] }],
      ["温泉でもよい", { outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1, action: "set", target: "experience", modality: "acceptable", precision: "qualitative", frame: "actual", quote: "温泉でもよい", value: { kind: "text", text: "温泉" } }], unresolvedFragments: [] }],
      ["富山に変更", { outcome: "delta", speechAct: "correct", operations: [{ atomicGroup: 1, action: "replace", target: "destination", modality: "preferred", precision: "exact", frame: "actual", quote: "富山に変更", value: { kind: "place_label", label: "富山" } }], unresolvedFragments: [] }],
      ["行き先は未定に戻して", { outcome: "delta", speechAct: "cancel", operations: [{ atomicGroup: 1, action: "retract", target: "destination", frame: "actual", quote: "未定に戻して" }], unresolvedFragments: [] }],
      ["2番目で", { outcome: "delta", speechAct: "confirm", operations: [{ atomicGroup: 1, action: "set", target: "candidate_selection",
        modality: "preferred", precision: "exact", frame: "actual", quote: "2番目", value: { kind: "presentation_ordinal", ordinal: 2 } }], unresolvedFragments: [] }],
      ["金沢もあり", { outcome: "delta", speechAct: "consider", operations: [{ atomicGroup: 1, action: "add_alternative", target: "destination", modality: "acceptable", precision: "exact", frame: "actual", quote: "金沢もあり", value: { kind: "place_label", label: "金沢" } }], unresolvedFragments: [] }],
      ["大阪もあり", { outcome: "delta", speechAct: "consider", operations: [{ atomicGroup: 1, action: "add_alternative", target: "destination", modality: "acceptable", precision: "exact", frame: "actual", quote: "大阪もあり", value: { kind: "place_label", label: "大阪" } }], unresolvedFragments: [] }],
    ] as const);
    const interpretIntent = vi.fn(async ({ userRequest }: { userRequest: string }) => structuredClone(interpretations.get(userRequest)!));
    const app = createConversationTurnApplication({ turns: f.turns, runAgentTurn: f.runAgentTurn, interpretIntent });
    const turn = async (index: number, userRequest: string) => app.runConversationTurn({ principal, conversationId,
      turnId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, userRequest, uiContext: { calendarDate: "2026-09-25" } });

    await turn(10, "出雲大社に行きたい"); await turn(11, "明日出発");
    let overlay = (await f.turns.getWorkingState(principal, conversationId))!.semantic!.overlay;
    expect(overlay.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "destination", value: { kind: "place_label", label: "出雲大社" } }),
      expect.objectContaining({ target: "start_date", value: expect.objectContaining({ kind: "local_date", date: "2026-09-26", expression: "tomorrow",
        anchorDate: "2026-09-25", resolverVersion: "calendar-v1" }) }),
    ]));

    await turn(12, "温泉でもよい");
    overlay = (await f.turns.getWorkingState(principal, conversationId))!.semantic!.overlay;
    expect(overlay.facts.find(({ target }) => target === "experience")?.modality).toBe("acceptable");

    await turn(13, "富山に変更"); await turn(14, "行き先は未定に戻して");
    overlay = (await f.turns.getWorkingState(principal, conversationId))!.semantic!.overlay;
    expect(overlay.facts.some(({ target }) => target === "destination")).toBe(false);
    expect(overlay.tombstones).toContainEqual(expect.objectContaining({ target: "destination", reason: "retracted" }));

    await turn(15, "2番目で");
    overlay = (await f.turns.getWorkingState(principal, conversationId))!.semantic!.overlay;
    expect(overlay.facts.find(({ target }) => target === "candidate_selection")?.value).toMatchObject({ kind: "candidate_ref", candidateRef: "candidate:toyama" });

    await turn(16, "金沢もあり"); await turn(17, "大阪もあり");
    overlay = (await f.turns.getWorkingState(principal, conversationId))!.semantic!.overlay;
    expect(overlay.facts.filter(({ target }) => target === "destination").map(({ value }) => value)).toEqual([
      { kind: "place_label", label: "金沢" }, { kind: "place_label", label: "大阪" },
    ]);
    expect(f.runAgentTurn.mock.calls.every(([runtimeInput]) => !("expected" in runtimeInput))).toBe(true);
  });
  it("returns only persisted final text, replays completion without Agent execution", async () => {
    const f = await setup();
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect(f.runAgentTurn).toHaveBeenCalledTimes(1);
    expect(f.runAgentTurn).toHaveBeenCalledWith({ principal, conversationId, userRequest: input.userRequest, tripId: undefined, uiContext: undefined }, 1);
    expect(JSON.stringify([...f.records.values()])).not.toContain("private");
  });
  it.each([
    ["failed", "agent_failed"],
    ["limit_reached", "limit_reached"],
    ["throw", "unavailable"],
  ] as const)("records %s as failed and retries without a second user message", async (status, error) => {
    const f = await setup();
    f.runAgentTurn.mockImplementationOnce(async () => { if (status === "throw") throw new Error("private"); return { ...success, status: status as AgentRuntimeResult["status"] }; });
    await expect(f.app.runConversationTurn(input)).rejects.toMatchObject({ message: error });
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(1);
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(2);
  });
  it("persists normal follow-up answers", async () => {
    const f = await setup(); f.runAgentTurn.mockResolvedValueOnce({ ...success, status: "follow_up" });
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "follow_up", response: "案内" });
  });
  it("records save completion only after the turn receipt commits", async () => {
    const f = await setup(), record = vi.fn(async () => undefined);
    const complete = vi.spyOn(f.turns, "completeTurn");
    const app = createConversationTurnApplication({ turns: f.turns, runAgentTurn: f.runAgentTurn, diagnostics: { record } });
    await app.runConversationTurn(input);
    expect(complete).toHaveBeenCalledOnce();
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "save", reason: "completed", correlation: { turnId: secondId } }));
    expect(complete.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder.at(-1)!);
  });
  it("recovers Agent success before storage failure after lease expiry", async () => {
    const f = await setup(), record = vi.fn(async () => undefined);
    const complete = vi.spyOn(f.turns, "completeTurn").mockRejectedValueOnce(new Error("unavailable"));
    const firstApp = createConversationTurnApplication({ turns: f.turns, runAgentTurn: f.runAgentTurn, diagnostics: { record } });
    await expect(firstApp.runConversationTurn(input)).rejects.toThrow("unavailable");
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "save", reason: "completion_ambiguous", incomplete: true }));
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(1);
    await expect(f.app.runConversationTurn(input)).rejects.toMatchObject({ code: "conflict" });
    const turns = new DynamoDbConversationTurnRepository("test-state", f.client, { now: () => new Date(f.clock.now().getTime() + 300_000) });
    const app = createConversationTurnApplication({ turns, runAgentTurn: f.runAgentTurn });
    expect(await app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect(f.runAgentTurn).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(1);
  });
  it("does not mark a committed completion failed when its response is lost", async () => {
    const f = await setup(); const fail = vi.spyOn(f.turns, "failTurn");
    f.runAgentTurn.mockImplementationOnce(async () => { f.faults.lostResponse = true; return success; });
    await expect(f.app.runConversationTurn(input)).rejects.toMatchObject({ code: "unavailable" });
    expect(fail).not.toHaveBeenCalled();
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect(f.runAgentTurn).toHaveBeenCalledTimes(1);
  });
  it("concurrent duplicate requests execute Agent at most once while lease is live", async () => {
    const f = await setup();
    const results = await Promise.allSettled([f.app.runConversationTurn(input), f.app.runConversationTurn(input)]);
    expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(f.runAgentTurn).toHaveBeenCalledTimes(1);
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(2);
  });
});
