import { describe, expect, it } from "vitest";
import { DynamoDbConversationTurnRepository, conversationTurnLimits } from "./dynamodb-conversation-turn-repository.js";
import { stateDynamoFixture, stateA as principal, stateB, conversationId, secondId, stateMetadata } from "./state-dynamodb.fixture.js";
import type { ConversationTurnLease } from "../ports/conversation-turn-repository.js";

const turnId = "33333333-3333-4333-8333-333333333333";
const identity = { principal, conversationId, turnId }, request = { userRequest: "旅行の相談" };
const result = { status: "completed" as const, response: "候補を案内します" };
async function setup() {
  const f = stateDynamoFixture();
  let time = f.clock.now().getTime();
  const clock = { now: () => new Date(time) };
  const turns = new DynamoDbConversationTurnRepository("test-state", f.client, clock);
  await f.conversations.create(principal, conversationId, stateMetadata());
  return { ...f, turns, advance: () => { time += conversationTurnLimits.leaseMs; } };
}
async function begin(f: Awaited<ReturnType<typeof setup>>) {
  const start = await f.turns.beginTurn(identity, request);
  expect(start.state).toBe("started");
  return (start as { lease: ConversationTurnLease }).lease;
}
describe("Conversation turn transactions", () => {
  it("atomically appends once and replays completion across fresh repository instances", async () => {
    const f = await setup(), lease = await begin(f);
    await expect(f.turns.beginTurn(identity, request)).rejects.toMatchObject({ code: "conflict" });
    expect(await f.turns.completeTurn(identity, lease, result)).toEqual(result);
    expect(await f.turns.completeTurn(identity, lease, result)).toEqual(result);
    const fresh = new DynamoDbConversationTurnRepository("test-state", f.client, f.clock);
    expect(await fresh.beginTurn(identity, request)).toEqual({ state: "completed", result });
    expect(await f.conversations.get(principal, conversationId)).toMatchObject({ messageCount: 2, revision: 2 });
    expect((await f.conversations.history(principal, conversationId)).items.map(({ role, text, sequence }) => ({ role, text, sequence })))
      .toEqual([{ role: "user", text: request.userRequest, sequence: 1 }, { role: "assistant", text: result.response, sequence: 2 }]);
    await expect(f.turns.completeTurn(identity, lease, { ...result, response: "changed" })).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects changed input including Trip/UI references before and after completion", async () => {
    const f = await setup(), lease = await begin(f);
    for (const changed of [{ userRequest: "different" }, { ...request, tripId: secondId }, { ...request, uiContext: { itemId: "item" } },
      { ...request, uiContext: { calendarDate: "2026-09-21" } }]) {
      await expect(f.turns.beginTurn(identity, changed)).rejects.toMatchObject({ code: "conflict" });
    }
    await f.turns.completeTurn(identity, lease, result);
    await expect(f.turns.beginTurn(identity, { userRequest: "different" })).rejects.toMatchObject({ code: "conflict" });
  });
  it("binds the retry hash to the original calendar date", async () => {
    const f = await setup();
    const dated = { ...request, uiContext: { calendarDate: "2026-09-22" } };
    const started = await f.turns.beginTurn(identity, dated);
    expect(started.state).toBe("started");
    if (started.state !== "started") throw new Error();
    await f.turns.failTurn(identity, started.lease);
    await expect(f.turns.beginTurn(identity, { ...dated, uiContext: { calendarDate: "2026-09-23" } })).rejects.toMatchObject({ code: "conflict" });
    expect((await f.turns.beginTurn(identity, dated)).state).toBe("started");
  });
  it("atomically retains visible outcome and presented order as working state", async () => {
    const f = await setup(), lease = await begin(f);
    const enriched = { ...result,
      turnObservation: { outcome: "progress" as const, progress: [{ kind: "candidates" as const, refs: ["candidate:b", "candidate:a"] }] },
      presentationReceipt: { presentationId: turnId, version: 1 as const,
        entries: [{ ordinal: 1, candidateRef: "candidate:b" }, { ordinal: 2, candidateRef: "candidate:a" }] } };
    await f.turns.completeTurn(identity, lease, enriched);
    expect(await f.turns.getWorkingState(principal, conversationId)).toMatchObject({ revision: 0,
      sourceTurnId: turnId, sourceUserSequence: 1, lastOutcome: { outcome: "progress" },
      presentations: [{ entries: [{ ordinal: 1, candidateRef: "candidate:b" }, { ordinal: 2, candidateRef: "candidate:a" }] }] });
  });
  it("recovers failed attempts immediately and crashed attempts after expiry with stale-worker fencing", async () => {
    const f = await setup(), first = await begin(f);
    await f.turns.failTurn(identity, first); await f.turns.failTurn(identity, first);
    const second = await begin(f);
    await expect(f.turns.completeTurn(identity, first, result)).rejects.toMatchObject({ code: "conflict" });
    f.advance();
    await expect(f.turns.completeTurn(identity, second, result)).rejects.toMatchObject({ code: "conflict" });
    const third = await begin(f);
    await expect(f.turns.failTurn(identity, second)).rejects.toMatchObject({ code: "conflict" });
    await f.turns.completeTurn(identity, third, result);
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(2);
  });
  it("recovers lost begin/complete responses without duplicate messages", async () => {
    const f = await setup(); f.faults.lostResponse = true;
    await expect(begin(f)).rejects.toMatchObject({ code: "unavailable" });
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(1);
    f.advance(); const lease = await begin(f);
    f.faults.lostResponse = true;
    await expect(f.turns.completeTurn(identity, lease, result)).rejects.toMatchObject({ code: "unavailable" });
    expect(await f.turns.beginTurn(identity, request)).toEqual({ state: "completed", result });
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(2);
  });
  it("allows only one concurrent begin and complete transaction", async () => {
    const f = await setup();
    const begins = await Promise.allSettled([f.turns.beginTurn(identity, request), f.turns.beginTurn(identity, request)]);
    expect(begins.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = begins.find((r) => r.status === "fulfilled")!;
    if (winner.status !== "fulfilled" || winner.value.state !== "started") throw new Error();
    await Promise.allSettled([f.turns.completeTurn(identity, winner.value.lease, result), f.turns.completeTurn(identity, winner.value.lease, result)]);
    expect((await f.conversations.get(principal, conversationId))?.messageCount).toBe(2);
    expect(await f.turns.beginTurn(identity, request)).toEqual({ state: "completed", result });
  });
  it("scopes equal IDs to owner and conversation and rejects foreign leases", async () => {
    const f = await setup(), lease = await begin(f);
    await expect(f.turns.beginTurn({ ...identity, principal: stateB }, request)).rejects.toMatchObject({ code: "not-found" });
    await expect(f.turns.completeTurn({ ...identity, principal: stateB }, lease, result)).rejects.toMatchObject({ code: "not-found" });
    await f.conversations.create(stateB, conversationId, stateMetadata());
    await f.conversations.create(principal, secondId, stateMetadata());
    expect((await f.turns.beginTurn({ ...identity, principal: stateB }, request)).state).toBe("started");
    expect((await f.turns.beginTurn({ ...identity, conversationId: secondId }, request)).state).toBe("started");
    await expect(f.turns.completeTurn({ ...identity, principal: stateB }, lease, result)).rejects.toMatchObject({ code: "conflict" });
  });
  it("fences delete against begin and complete, then purges turn receipts", async () => {
    const f = await setup();
    f.faults.beforeWrite = async () => { await f.conversations.delete(principal, conversationId, 0); };
    await expect(begin(f)).rejects.toMatchObject({ code: "not-found" });
    expect(f.records.size).toBe(1);
    const g = await setup(), lease = await begin(g);
    g.faults.beforeWrite = async () => { await g.conversations.delete(principal, conversationId, 1); };
    await expect(g.turns.completeTurn(identity, lease, result)).rejects.toMatchObject({ code: "not-found" });
    await expect(g.turns.beginTurn(identity, request)).rejects.toMatchObject({ code: "not-found" });
    expect(g.records.size).toBe(1);
  });
  it("bounds receipt growth without expiring old identities", async () => {
    const f = await setup(), lease = await begin(f);
    await f.turns.completeTurn(identity, lease, result);
    const metadata = [...f.records.values()].find((v) => v.sk.S?.startsWith("CONVERSATION#"))!;
    metadata.payload!.S = JSON.stringify({ ...JSON.parse(metadata.payload!.S!), messageCount: conversationTurnLimits.newTurnMessageLimit });
    await expect(f.turns.beginTurn({ ...identity, turnId: secondId }, request)).rejects.toMatchObject({ code: "conflict" });
    expect((await f.turns.beginTurn(identity, request)).state).toBe("completed");
  });
  it("rejects malformed/oversized inputs and excludes internal data from storage", async () => {
    const f = await setup(); const count = f.commands.length;
    for (const invalid of [{ userRequest: " " }, { userRequest: "あ".repeat(6000) }, { ...request, ownerId: stateB.subject },
      { ...request, uiContext: { token: "secret" } }, { ...request, uiContext: { calendarDate: "2026-02-30" } }]) {
      await expect(f.turns.beginTurn(identity, invalid as never)).rejects.toMatchObject({ code: "invalid-input" });
    }
    await expect(f.turns.beginTurn({ ...identity, turnId: "unbounded" }, request)).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.commands.length).toBe(count);
    const lease = await begin(f);
    await expect(f.turns.completeTurn(identity, lease, { ...result, trace: "secret" } as never)).rejects.toMatchObject({ code: "invalid-input" });
    await f.turns.completeTurn(identity, lease, result);
    expect(JSON.stringify([...f.records.values()])).not.toContain("secret");
    const stored = [...f.records.values()].find((v) => v.sk.S?.startsWith("TURN#"))!;
    stored.payload = { S: '{"state":"completed"}' };
    await expect(f.turns.beginTurn(identity, request)).rejects.toMatchObject({ code: "unavailable" });
  });
});

it("resumes bounded receipt deletion after messages are purged and cleanup fails", async () => {
  const f = await setup();
  for (let i = 0; i < 51; i++) {
    await f.turns.beginTurn({ ...identity, turnId: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}` }, request);
  }
  expect(await f.conversations.delete(principal, conversationId, 51)).toEqual({ complete: false });
  expect(await f.conversations.delete(principal, conversationId, 51)).toEqual({ complete: false });
  f.faults.failPurge = true;
  await expect(f.conversations.delete(principal, conversationId, 51)).rejects.toMatchObject({ code: "unavailable" });
  expect(await f.conversations.delete(principal, conversationId, 51)).toEqual({ complete: true });
  expect(f.records.size).toBe(1);
});

it("metadata contention leaves no partial receipt or message and retry uses the next contiguous sequence", async () => {
  const f = await setup();
  f.faults.beforeWrite = async () => { await f.conversations.append(principal, conversationId, 0, [{ role: "user", text: "other message" }]); };
  await expect(begin(f)).rejects.toMatchObject({ code: "conflict" });
  expect([...f.records.values()].filter((v) => v.sk.S?.startsWith("TURN#"))).toHaveLength(0);
  const lease = await begin(f); expect(lease.userSequence).toBe(2);
  await f.turns.completeTurn(identity, lease, result);
  expect((await f.conversations.history(principal, conversationId)).items.map((m) => m.sequence)).toEqual([1, 2, 3]);
});

it("atomically retains public proposals in receipt/history and detects a changed proposal on retry", async () => {
  const f = await setup(), lease = await begin(f);
  const tripUpdateProposal = { tripId: secondId, baseRevision: 0, summary: "条件案", patches: [{ type: "request" as const, request: { constraints: [], assumptions: [] } }] as const };
  const final = { ...result, tripUpdateProposal };
  f.faults.lostResponse = true;
  await expect(f.turns.completeTurn(identity, lease, final)).rejects.toMatchObject({ code: "unavailable" });
  expect(await f.turns.beginTurn(identity, request)).toEqual({ state: "completed", result: final });
  expect((await f.conversations.history(principal, conversationId)).items[1].tripUpdateProposal).toEqual(tripUpdateProposal);
  await expect(f.turns.completeTurn(identity, lease, { ...final, tripUpdateProposal: { ...tripUpdateProposal, baseRevision: 1 } })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.conversations.append(principal, conversationId, 2, [{ role: "assistant", text: "偽造", tripUpdateProposal }] as never)).rejects.toMatchObject({ code: "invalid-input" });
});
it("retains draft proposals across a lost completion response and rejects changed, foreign or client-injected proposals", async () => {
  const f = await setup(), lease = await begin(f), baseRequest = { constraints: [], assumptions: [] };
  const consultationRequestProposal = { conversationId, baseRequest, request: { ...baseRequest, goal: "美術館" }, summary: "条件案" };
  const final = { ...result, consultationRequestProposal };
  await expect(f.turns.completeTurn(identity, lease, { ...result, consultationRequestProposal: { ...consultationRequestProposal, conversationId: secondId } })).rejects.toMatchObject({ code: "invalid-input" });
  f.faults.lostResponse = true;
  await expect(f.turns.completeTurn(identity, lease, final)).rejects.toMatchObject({ code: "unavailable" });
  expect(await f.turns.beginTurn(identity, request)).toEqual({ state: "completed", result: final });
  expect((await f.conversations.history(principal, conversationId)).items[1].consultationRequestProposal).toEqual(consultationRequestProposal);
  await expect(f.turns.completeTurn(identity, lease, { ...final, consultationRequestProposal: { ...consultationRequestProposal, summary: "変更" } })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.conversations.append(principal, conversationId, 2, [{ role: "assistant", text: "偽造", consultationRequestProposal }] as never)).rejects.toMatchObject({ code: "invalid-input" });
});
