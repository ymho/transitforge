import { describe, expect, it } from "vitest";
import { DynamoDbConversationTurnRepository, conversationTurnLimits } from "./dynamodb-conversation-turn-repository.js";
import { stateDynamoFixture, stateA, stateB, conversationId, secondId, stateMetadata } from "./state-dynamodb.fixture.js";
import { conditionDelta, summarizeConditionReceipts } from "@raiquora/agent/conversation-condition";
import { publicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
const turnId = "71600000-0000-4000-8000-000000000001";
const identity = { principal: stateA, conversationId, turnId };
const request = { userRequest: "大阪から京都に行きたい" };
const origin = { target: "origin" as const, place: "大阪", quote: "大阪から" };
const destination = { target: "destination" as const, place: "京都", quote: "京都に行きたい" };
const result = { status: "completed" as const, response: "候補を案内します" };
async function setup() {
  const f = stateDynamoFixture(); let time = f.clock.now().getTime();
  const clock = { now: () => new Date(time) };
  const fresh = () => new DynamoDbConversationTurnRepository("test-state", f.client, clock);
  const turns = fresh();
  const { tripId: _trip, ...metadata } = stateMetadata();
  await f.conversations.create(stateA, conversationId, metadata);
  const begun = await turns.beginTurn(identity, request);
  if (begun.state !== "started") throw new Error("Expected a new turn");
  return { ...f, turns, fresh, lease: begun.lease, advance: () => { time += conversationTurnLimits.leaseMs; } };
}
const overlay = async (f: Awaited<ReturnType<typeof setup>>) => (await f.turns.getWorkingState(stateA, conversationId))?.semantic?.overlay;

describe("condition-operation acceptance and replay", () => {
  it("persists two independent operations and replays either without rolling back the latest state", async () => {
    const f = await setup();
    const first = await f.turns.acceptCondition(identity, f.lease, origin);
    const second = await f.turns.acceptCondition(identity, f.lease, destination);
    expect(first.intentRevision).toBe(1); expect(second.intentRevision).toBe(2);
    expect(await f.fresh().acceptCondition(identity, f.lease, { ...origin, quote: "大阪" })).toEqual(first);
    expect((await overlay(f))?.intentRevision).toBe(2);
    expect((await overlay(f))?.facts.map(({ target }) => target).sort()).toEqual(["destination", "origin"]);
    await expect(f.turns.acceptCondition(identity, f.lease, { ...origin, place: "神戸" })).rejects.toMatchObject({ code: "conflict" });
    const summary = publicSemanticReceipt(summarizeConditionReceipts([first, second])!);
    const final = { ...result, semanticReceipt: summary };
    await f.turns.completeTurn(identity, f.lease, final);
    expect(await f.fresh().beginTurn(identity, request)).toEqual({ state: "completed", result: final });
    expect((await f.conversations.history(stateA, conversationId)).items).toHaveLength(2);
    expect(summary.changes.map(({ target }) => target)).toEqual(["origin", "destination"]);
  });
  it("persists party as one operation slot and replays the same requested state without inferring composition", async () => {
    const f = await setup();
    const count = { target: "party_size" as const, party: { kind: "count" as const, people: 2 }, quote: "2人で" };
    const first = await f.turns.acceptCondition(identity, f.lease, count);
    expect(first.intentRevision).toBe(1);
    expect((await overlay(f))?.facts[0]?.value).toEqual({ kind: "quantity", amount: 2, unit: "people" });
    expect(await f.fresh().acceptCondition(identity, f.lease, { ...count, quote: "2人" })).toEqual(first);
    expect((await overlay(f))?.intentRevision).toBe(1);
    await expect(f.turns.acceptCondition(identity, f.lease, {
      target: "party_size", party: { kind: "composition", adults: 2, children: [] }, quote: "大人2人",
    })).rejects.toMatchObject({ code: "conflict" });
  });
  it("retains a committed first operation when the second fails and resumes only the missing work", async () => {
    const f = await setup();
    const first = await f.turns.acceptCondition(identity, f.lease, origin);
    f.faults.beforeWrite = () => { throw new Error("synthetic write unavailable"); };
    await expect(f.turns.acceptCondition(identity, f.lease, destination)).rejects.toMatchObject({ code: "unavailable" });
    await f.turns.failTurn(identity, f.lease);
    const retry = await f.fresh().beginTurn(identity, request);
    if (retry.state !== "intent_accepted") throw new Error("Expected accepted operation recovery");
    expect(retry.conditionReceipts).toEqual([first]);
    expect(await f.turns.acceptCondition(identity, retry.lease, origin)).toEqual(first);
    const next = await f.turns.acceptCondition(identity, retry.lease, destination);
    expect(next.intentRevision).toBe(2);
    expect((await overlay(f))?.facts).toHaveLength(2);
    expect((await f.conversations.history(stateA, conversationId)).items).toHaveLength(1);
  });
  it("recovers an ambiguous acceptance and an ambiguous B commit without duplicate messages or mutations", async () => {
    const f = await setup(); f.faults.lostResponse = true;
    await expect(f.turns.acceptCondition(identity, f.lease, destination)).rejects.toMatchObject({ code: "unavailable" });
    expect((await overlay(f))?.intentRevision).toBe(1);
    f.advance();
    const retry = await f.fresh().beginTurn(identity, request);
    if (retry.state !== "intent_accepted") throw new Error();
    await expect(f.turns.acceptCondition(identity, f.lease, destination)).rejects.toMatchObject({ code: "conflict" });
    const receipt = await f.turns.acceptCondition(identity, retry.lease, destination);
    expect(receipt.intentRevision).toBe(1);
    f.faults.lostResponse = true;
    await expect(f.turns.completeTurn(identity, retry.lease, result)).rejects.toMatchObject({ code: "unavailable" });
    expect(await f.fresh().beginTurn(identity, request)).toEqual({ state: "completed", result });
    expect((await f.conversations.history(stateA, conversationId)).items).toHaveLength(2);
    expect((await overlay(f))?.intentRevision).toBe(1);
  });
  it("uses CAS for racing operations and safely retries the losing independent operation", async () => {
    const f = await setup();
    const results = await Promise.allSettled([f.turns.acceptCondition(identity, f.lease, origin), f.turns.acceptCondition(identity, f.lease, destination)]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    await f.turns.acceptCondition(identity, f.lease, origin);
    await f.turns.acceptCondition(identity, f.lease, destination);
    expect((await overlay(f))?.intentRevision).toBe(2);
  });
  it("fences unfinished older turns before new writes, new replies or resumed work", async () => {
    const f = await setup();
    await f.turns.acceptCondition(identity, f.lease, destination);
    const newer = { ...identity, turnId: secondId };
    const begun = await f.turns.beginTurn(newer, { userRequest: "神戸に変更" });
    if (begun.state !== "started") throw new Error();
    await f.turns.acceptCondition(newer, begun.lease, { ...destination, place: "神戸", quote: "神戸" });
    await expect(f.turns.acceptCondition(identity, f.lease, origin)).rejects.toMatchObject({ code: "conflict" });
    await expect(f.turns.completeTurn(identity, f.lease, result)).rejects.toMatchObject({ code: "conflict" });
    await f.turns.failTurn(identity, f.lease);
    await expect(f.turns.beginTurn(identity, request)).rejects.toMatchObject({ code: "conflict" });
    expect((await overlay(f))?.facts[0]?.value).toEqual({ kind: "place_label", label: "神戸" });
    await f.turns.completeTurn(newer, begun.lease, result);
  });
  it("allows no writes after completion and keeps completed replay available after later turns", async () => {
    const f = await setup(); await f.turns.completeTurn(identity, f.lease, result);
    await expect(f.turns.acceptCondition(identity, f.lease, destination)).rejects.toMatchObject({ code: "conflict" });
    const begun = await f.turns.beginTurn({ ...identity, turnId: secondId }, { userRequest: "次の相談" });
    expect(begun.state).toBe("started");
    expect(await f.turns.beginTurn(identity, request)).toEqual({ state: "completed", result });
  });
  it("keeps owner, turn and deletion boundaries when replaying conditions", async () => {
    const f = await setup();
    await f.turns.acceptCondition(identity, f.lease, destination);
    await expect(f.turns.acceptCondition({ ...identity, principal: stateB }, f.lease, destination)).rejects.toMatchObject({ code: "not-found" });
    await expect(f.turns.acceptCondition({ ...identity, turnId: secondId }, f.lease, destination)).rejects.toMatchObject({ code: "conflict" });
    const conversation = await f.conversations.get(stateA, conversationId);
    await f.conversations.delete(stateA, conversationId, conversation!.revision);
    await expect(f.turns.acceptCondition(identity, f.lease, destination)).rejects.toMatchObject({ code: "not-found" });
  });
  it("reads legacy acceptance for replay without opening it to new condition mutations", async () => {
    const f = await setup();
    const receipt = await f.turns.acceptIntent(identity, f.lease, conditionDelta(destination, turnId,
      { version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] }));
    await f.turns.failTurn(identity, f.lease);
    const retry = await f.turns.beginTurn(identity, request);
    if (retry.state !== "intent_accepted") throw new Error();
    expect(retry.receipt).toEqual(receipt); expect(retry.conditionReceipts).toBeUndefined();
    await expect(f.turns.acceptCondition(identity, retry.lease, origin)).rejects.toMatchObject({ code: "conflict" });
    await f.turns.completeTurn(identity, retry.lease, result);
  });
  it("does not replay a receipt transplanted from a different turn", async () => {
    const f = await setup(); await f.turns.acceptCondition(identity, f.lease, destination);
    const key = `OWNER#${stateA.subject}/TURN#${conversationId}#${turnId}`;
    const item = f.records.get(key)!; const payload = JSON.parse(item.payload.S!);
    payload.conditionUpdates.operations[0].receipt.mutationId = `condition:${secondId}:destination`;
    item.payload = { S: JSON.stringify(payload) };
    await expect(f.turns.acceptCondition(identity, f.lease, destination)).rejects.toMatchObject({ code: "unavailable" });
  });
});
