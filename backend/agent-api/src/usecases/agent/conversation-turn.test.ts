import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { stateDynamoFixture, stateA as principal, conversationId, secondId, stateMetadata } from "../../adapters/state-dynamodb.fixture.js";
import { DynamoDbConversationTurnRepository } from "../../adapters/dynamodb-conversation-turn-repository.js";
import { createConversationTurnApplication } from "./conversation-turn.js";

const input = { principal, conversationId, turnId: secondId, userRequest: "旅の相談" };
const success = { status: "completed", response: "案内", trace: { secret: "private" }, evidence: [{ raw: "private" }] } as unknown as AgentRuntimeResult;
async function setup() {
  const f = stateDynamoFixture(); await f.conversations.create(principal, conversationId, stateMetadata());
  const turns = new DynamoDbConversationTurnRepository("test-state", f.client, f.clock);
  const runAgentTurn = vi.fn(async () => success);
  return { ...f, turns, runAgentTurn, app: createConversationTurnApplication({ turns, runAgentTurn }) };
}
describe("Conversation turn Application", () => {
  it("returns only persisted final text, replays completion without Agent execution", async () => {
    const f = await setup();
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect(await f.app.runConversationTurn(input)).toEqual({ status: "completed", response: "案内" });
    expect(f.runAgentTurn).toHaveBeenCalledTimes(1);
    expect(f.runAgentTurn).toHaveBeenCalledWith({ principal, conversationId, userRequest: input.userRequest, tripId: undefined, uiContext: undefined }, 1);
    expect(JSON.stringify([...f.records.values()])).not.toContain("private");
  });
  it.each(["failed", "limit_reached", "throw"])("records %s as failed and retries without a second user message", async (status) => {
    const f = await setup();
    f.runAgentTurn.mockImplementationOnce(async () => { if (status === "throw") throw new Error("private"); return { ...success, status: status as AgentRuntimeResult["status"] }; });
    await expect(f.app.runConversationTurn(input)).rejects.toMatchObject({ message: "unavailable" });
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
