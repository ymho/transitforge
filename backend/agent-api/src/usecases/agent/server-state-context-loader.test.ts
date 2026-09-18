import { describe, expect, it, vi } from "vitest";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { createTrip } from "@raiquora/trip/trip";
import { createAgentContextSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { agentDecisionContextText, buildAgentDecisionContext } from "@raiquora/agent/agent-decision-context";
import { createServerStateContextLoader, serverStateContextLimits } from "./server-state-context-loader.js";
import { ConversationApplication } from "../conversation-application.js";
import { ProfileApplication } from "../profile-application.js";
import { stateDynamoFixture, stateA as a, stateB as b, conversationId as id, secondId as tripId, stateMetadata, stateProfile } from "../../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../../adapters/trip-dynamodb.fixture.js";

function setup() {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const conversations = new ConversationApplication(state.conversations, () => id), profiles = new ProfileApplication(state.profiles, state.clock);
  const history = vi.spyOn(conversations, "history");
  const load = createServerStateContextLoader({ conversations, profiles, trips: trips.repository });
  return { ...state, trips, conversations, profiles, history, load };
}
const metadata = () => ({ ...stateMetadata(), tripId: undefined });
const trip = () => ({ ...createTrip(tripId, "採用した旅", "2026-09-18T00:00:00Z", [
  { id: "stay", title: "宿泊", type: "stay" as const, schedule: { type: "unscheduled" as const }, selection: { status: "unselected" as const } },
]), request: { goal: "鉄道で旅行", constraints: [], assumptions: [] } });

describe("Server State Context Loader", () => {
  it("restores metadata/history, existing profile projection and owner Trip without writes", async () => {
    const f = setup(); await f.conversations.create(a, { ...stateMetadata(), resolvedTopics: ["行先"], pendingTopics: ["日程"] });
    await f.conversations.append(a, id, 0, [{ role: "user", text: "履歴" }, { role: "assistant", text: "回答" }]);
    await f.profiles.update(a, { ...stateProfile(), aiNoteFields: ["budget"] }, null);
    await f.trips.repository.create(a, trip());
    const stateBefore = structuredClone(f.records), tripBefore = structuredClone(f.trips.records);
    const context = await f.load({ principal: a, conversationId: id, tripId, uiContext: { itemId: "stay" } });
    expect(context.conversation).toMatchObject({ title: "会話", scope: "trip", summary: "相談", resolvedTopics: ["行先"], pendingTopics: ["日程"],
      messages: [{ role: "user", text: "履歴" }, { role: "assistant", text: "回答" }] });
    expect(context.travelProfile).toEqual(createAgentContextSnapshot({ ...stateProfile(), aiNoteFields: ["budget"] }).profile);
    expect(context.currentTrip).toEqual(createAgentContextSnapshot(undefined, trip()).trip);
    expect(context.featureContext?.uiFocus).toMatchObject({ itemId: "stay", item: { itemId: "stay", summary: "宿泊" } });
    expect(f.records).toEqual(stateBefore); expect(f.trips.records).toEqual(tripBefore);
    expect(JSON.stringify(context)).not.toContain(a.subject);
  });
  it("treats another owner's conversation and an unknown ID identically", async () => {
    const f = setup(); await f.conversations.create(a, metadata());
    for (const conversationId of [id, tripId]) await expect(f.load({ principal: b, conversationId })).rejects.toMatchObject({ code: "not-found", message: "not-found" });
    expect(f.history).not.toHaveBeenCalled();
  });
  it("checks owner for explicit Trips and references in the caller's own conversation", async () => {
    const f = setup(); await f.trips.repository.create(a, trip());
    await f.conversations.create(b, stateMetadata());
    for (const request of [{ principal: b, tripId }, { principal: b, tripId: id }, { principal: b, conversationId: id }]) {
      await expect(f.load(request)).rejects.toMatchObject({ code: "not-found", message: "not-found" });
    }
    expect(f.history).not.toHaveBeenCalled();
  });
  it("rejects contradictory Trip references before looking up either Trip", async () => {
    const f = setup(); await f.conversations.create(a, stateMetadata());
    await expect(f.load({ principal: a, conversationId: id, tripId: id })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.trips.commands).toHaveLength(0);
  });
  it("keeps A/B profiles isolated and preserves absence and consent", async () => {
    const f = setup();
    expect(await f.load({ principal: a })).toEqual({});
    await f.profiles.update(a, { ...stateProfile(), home: { station: "A駅" }, notes: { food: "非同意メモ", budget: "同意メモ" }, aiNoteFields: ["budget"] }, null);
    expect(await f.load({ principal: b })).toEqual({});
    await f.profiles.update(b, { ...stateProfile(), home: { station: "B駅" } }, null);
    const [left, right] = await Promise.all([f.load({ principal: a }), f.load({ principal: b })]);
    expect(left.travelProfile?.home).toEqual({ station: "A駅" }); expect(right.travelProfile?.home).toEqual({ station: "B駅" });
    expect(left.travelProfile?.consentedPreferenceNotes).toEqual({ budget: "同意メモ" });
    expect(JSON.stringify([left, right])).not.toContain("非同意メモ");
  });
  it("supports no conversation, no profile and an explicit authorized Trip", async () => {
    const f = setup(); await f.trips.repository.create(a, trip());
    const context = await f.load({ principal: a, tripId });
    expect(context.currentTrip?.request?.goal).toBe("鉄道で旅行");
    expect(context.conversation).toBeUndefined(); expect(context.travelProfile).toBeUndefined();
    expect(f.history).not.toHaveBeenCalled();
    await f.conversations.create(a, metadata());
    expect((await f.load({ principal: a, conversationId: id, tripId })).currentTrip?.title).toBe("採用した旅");
  });
  it("does not promote unknown/no-Trip UI items or other UI state", async () => {
    const f = setup(); await f.trips.repository.create(a, trip());
    for (const references of [{}, { tripId }]) {
      const context = await f.load({ principal: a, ...references, uiContext: { itemId: "unknown", tab: "private-tab", scroll: 100, camera: "private-camera" } as never });
      expect(context.featureContext).toBeUndefined(); expect(JSON.stringify(context)).not.toMatch(/private-tab|private-camera|unknown/);
    }
    await expect(f.load({ principal: a, tripId, uiContext: { itemId: "x".repeat(201) } })).rejects.toMatchObject({ code: "invalid-input" });
  });
  it("seeks only the newest 12 rows and bounds long history while retaining summary/topics", async () => {
    const f = setup(); await f.conversations.create(a, { ...metadata(), summary: "古い会話の要約", resolvedTopics: ["行先"] });
    for (let batch = 0; batch < 5; batch++) await f.conversations.append(a, id, batch, Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, text: `turn-${batch * 20 + i + 1}:` + "長".repeat(4000) })));
    const context = await f.load({ principal: a, conversationId: id });
    expect(f.history).toHaveBeenCalledExactlyOnceWith(a, id, { after: "000000000088", limit: 12 });
    expect(context.conversation?.messages?.length).toBeLessThanOrEqual(12);
    expect(context.conversation?.messages?.at(-1)?.text).toMatch(/^turn-100:/);
    expect(context.conversation?.summary).toBe("古い会話の要約");
    expect(context.conversation?.resolvedTopics).toEqual(["行先"]);
    expect(JSON.stringify(context.conversation).length).toBeLessThanOrEqual(serverStateContextLimits.conversationJsonCharacters);
    expect(context.conversation?.messages?.every((m) => m.text.length <= 1600)).toBe(true);
    const modelText = agentDecisionContextText(buildAgentDecisionContext({ executionId: "test", feature: "concierge", userRequest: "続けて", context }, []));
    expect(modelText.match(/<agent_context>([\s\S]*)<\/agent_context>/)![1].length).toBeLessThanOrEqual(24_000);
  });
  it("handles byte-limited storage pages and JSON-escaped history within bounded work", async () => {
    const f = setup(); await f.conversations.create(a, metadata());
    await f.conversations.append(a, id, 0, Array.from({ length: 20 }, () => ({ role: "assistant" as const, text: "\u0001".repeat(16 * 1024) })));
    const context = await f.load({ principal: a, conversationId: id });
    expect(f.history.mock.calls.length).toBeGreaterThan(1); expect(f.history.mock.calls.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(context.conversation).length).toBeLessThanOrEqual(12_000);
    const queries = f.commands.filter((c) => c instanceof QueryCommand);
    expect(queries[0].input.ExclusiveStartKey?.sk.S).toBe(`MESSAGE#${id}#000000000008`);
  });
  it("fails closed on conversation changes across metadata/history reads", async () => {
    const f = setup(); await f.conversations.create(a, metadata()); await f.conversations.append(a, id, 0, [{ role: "user", text: "履歴" }]);
    f.history.mockImplementationOnce(async (...args) => {
      await f.conversations.update(a, id, 1, { ...metadata(), summary: "更新済み" });
      return f.conversations.history(...args);
    });
    await expect(f.load({ principal: a, conversationId: id })).rejects.toMatchObject({ code: "conflict" });
  });
  it("does not fall back to empty context on storage failure or deleted conversations", async () => {
    const f = setup(); await f.conversations.create(a, metadata()); await f.conversations.delete(a, id, 0);
    await expect(f.load({ principal: a, conversationId: id })).rejects.toMatchObject({ code: "not-found" });
    vi.spyOn(f.profiles, "get").mockRejectedValueOnce(new Error("unavailable"));
    await expect(f.load({ principal: a })).rejects.toThrow("unavailable");
  });
  it("rejects missing principals and invalid IDs before reading", async () => {
    const f = setup();
    await expect(f.load({ principal: undefined as never })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(f.load({ principal: a, conversationId: "invalid" })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.load({ principal: a, tripId: "invalid" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.commands).toHaveLength(0); expect(f.trips.commands).toHaveLength(0);
  });
});

it("loads only the bounded history before the persisted user message, even on retry with later messages", async () => {
  const f = setup(); await f.conversations.create(a, metadata());
  await f.conversations.append(a, id, 0, Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, text: `message-${i + 1}` })));
  const load = createServerStateContextLoader({ conversations: f.conversations, profiles: f.profiles, trips: f.trips.repository }, { historyBeforeSequence: 15 });
  const context = await load({ principal: a, conversationId: id });
  expect(context.conversation?.messages?.map((m) => m.text)).toEqual(Array.from({ length: 12 }, (_, i) => `message-${i + 3}`));
  expect(f.history).toHaveBeenCalledExactlyOnceWith(a, id, { after: "000000000002", limit: 12 });
});
