import { expect, it, vi } from "vitest";
import { createTrip, applyTripProposal, type Trip } from "@raiquora/trip/trip";
import { createInteractiveTripSession, parseInteractiveTripCommand } from "./interactive-trip-session.js";

const tripId = "11111111-1111-4111-8111-111111111111";
const reason = "直前の結果と保存状態を確認する";
function fixture(maxTurns = 64) {
  let trip = createTrip(tripId, "動的評価", "2026-10-12T00:00:00Z");
  let failStateRead = false, streamError = false;
  const requests: Record<string, unknown>[] = [];
  const histories: { role: string; text: string; sequence: number; createdAt: string }[] = [];
  const streamRequests: Record<string, unknown>[] = [];
  const responses = new Map<string, string>();
  const mutations = new Map<string, Trip>();
  const key = "a".repeat(64);
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), body = JSON.parse(String(init?.body)); requests.push(body);
    expect(url.origin).toBe("https://example.test"); expect(url.search).toBe("");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-access-token");
    expect(init?.redirect).toBe("error");
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/trips/v1") {
      if (body.operation === "start-consultation") return json({ version: "trip-api-v1", trip, conversationId: tripId });
      if (body.operation === "get") return failStateRead ? new Response("unavailable", { status: 503 }) : json({ version: "trip-api-v1", trip });
      if (body.operation === "preview-plan-adoption") return json({ version: "trip-api-v1", status: "confirmation-required", confirmationKey: key,
        preview: { changes: { added: 0, replaced: 0, removed: 0 }, componentMap: [], proposal: { tripId, baseRevision: trip.revision, summary: "評価用の空変更", patches: [] } } });
      if (body.operation === "confirm-plan-adoption") {
        expect(body.confirmationKey).toBe(key); trip = { ...trip, revision: trip.revision + 1 };
        return json({ version: "trip-api-v1", status: "saved", trip });
      }
      if (body.operation === "mutate") {
        if (!mutations.has(body.mutationId)) { trip = { ...applyTripProposal(trip, body.proposal), revision: trip.revision + 1 }; mutations.set(body.mutationId, trip); }
        const saved = mutations.get(body.mutationId)!;
        return json({ version: "trip-api-v1", trip: saved, revision: saved.revision, mutationId: body.mutationId });
      }
      if (body.operation === "preview-item-decision") return json({ version: "trip-api-v1", status: "confirmation-required", confirmationKey: key,
        preview: { itemId: body.itemId, title: "手入力の予定", action: body.action, needsReconfirmation: false } });
      if (body.operation === "preview-trip-adoption") return json({ version: "trip-api-v1", status: "confirmation-required", confirmationKey: key,
        preview: { action: body.action, summary: "旅程全体の操作", needsReconfirmation: false } });
      if (["confirm-item-decision", "confirm-trip-adoption"].includes(body.operation)) {
        expect(body.confirmationKey).toBe(key);
        trip = { ...trip, revision: trip.revision + 1 };
        return json({ version: "trip-api-v1", status: "saved", trip });
      }
    }
    if (url.pathname === "/api/conversations/v1") return json({ version: "conversation-api-v1", items: histories });
    if (url.pathname === "/api/agent-stream") {
      streamRequests.push(body);
      let text = responses.get(body.turnId);
      if (!text) {
        text = streamRequests.length === 1 ? "出発時刻を教えてください" : "9時出発として確認します";
        responses.set(body.turnId, text);
        histories.push({ role: "user", text: body.userRequest, sequence: histories.length + 1, createdAt: trip.updatedAt },
          { role: "assistant", text, sequence: histories.length + 2, createdAt: trip.updatedAt });
      }
      const event = streamError ? { type: "error", code: "agent_failed" } : { type: "final", status: "completed", response: text };
      const frame = (name: string, seq: number, extra = {}) => `event: ${name}\ndata: ${JSON.stringify({ v: 1, runId: "run", seq, ...extra })}\n\n`;
      return new Response(frame("agent", 1, { event }) + frame("done", 2), { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error("unexpected endpoint");
  });
  let id = 0;
  const controller = createInteractiveTripSession({ origin: "https://example.test", fetcher,
    token: async () => "test-access-token", maxTurns, now: () => new Date("2026-10-12T16:00:00Z"),
    newId: () => id++ === 0 ? tripId : `22222222-2222-4222-8222-${String(id).padStart(12, "0")}` });
  return { controller, requests, streamRequests, setStateFailure: () => { failStateRead = true; }, setStreamFailure: () => { streamError = true; } };
}

it("waits for the evaluator's next input and preserves conversation, history and retry identity", async () => {
  const f = fixture();
  await f.controller.execute({ action: "start", title: "動的評価", reason });
  const first = await f.controller.execute({ action: "say", message: "尾道へ行きたい", reason });
  expect(f.streamRequests).toHaveLength(1);
  expect(first).toMatchObject({ events: [{ response: "出発時刻を教えてください" }], savedState: { historyComplete: true } });
  // This represents the external evaluator observing the answer, not a preloaded input list.
  const question = JSON.stringify(first);
  if (question.includes("出発時刻")) await f.controller.execute({ action: "say", message: "9時に出発します", reason: "回答が出発時刻を尋ねたので答える" });
  expect(f.streamRequests).toHaveLength(2);
  expect(f.streamRequests[1]).toMatchObject({ conversationId: tripId, tripId, userRequest: "9時に出発します", uiContext: { calendarDate: "2026-10-13" } });
  expect(f.streamRequests[0]?.turnId).not.toBe(f.streamRequests[1]?.turnId);
  await f.controller.execute({ action: "retry", reason });
  expect(f.streamRequests[2]).toEqual(f.streamRequests[1]);
  const observed = await f.controller.execute({ action: "inspect", reason });
  expect(observed).toMatchObject({ savedState: { history: [{}, {}, {}, {}] } });
  expect(f.streamRequests).toHaveLength(3);
});

it("sends manual edits through CAS, reuses their mutation ID and confirms only the chosen preview kind", async () => {
  const f = fixture(); await f.controller.execute({ action: "start", title: "評価", reason });
  const proposal = { tripId, baseRevision: 0, summary: "手入力で立ち寄りを追加", patches: [{ type: "add", item: {
    id: "manual-visit", type: "activity", title: "尾道の街歩き", category: "sightseeing", schedule: { type: "unscheduled" } } }] };
  expect(await f.controller.execute({ action: "edit", proposal, reason })).toMatchObject({ savedTrip: { revision: 1, items: [{ id: "manual-visit" }] } });
  await f.controller.execute({ action: "retry-edit", reason });
  const mutations = f.requests.filter(value => value.operation === "mutate");
  expect(mutations[1]).toEqual(mutations[0]);
  await f.controller.execute({ action: "preview-item", itemId: "manual-visit", decision: "confirm", reason });
  expect(await f.controller.execute({ action: "confirm", reason })).toMatchObject({ savedTrip: { revision: 2 } });
  await f.controller.execute({ action: "preview-trip", decision: "withdraw", reason });
  expect(await f.controller.execute({ action: "confirm", reason })).toMatchObject({ savedTrip: { revision: 3 } });
  expect(f.requests.filter(value => String(value.operation).startsWith("confirm-")).map(value => value.operation)).toEqual(["confirm-item-decision", "confirm-trip-adoption"]);
  await expect(f.controller.execute({ action: "edit", proposal, reason })).rejects.toThrow("stale_edit_target");
});

it("preserves the answer when state reload fails and reads saved state after an agent error", async () => {
  const f = fixture(); await f.controller.execute({ action: "start", title: "評価", reason });
  f.setStateFailure();
  expect(await f.controller.execute({ action: "say", message: "尾道", reason })).toMatchObject({ events: [{ type: "final" }], stateReadError: "saved_state_unavailable" });
  const g = fixture(); await g.controller.execute({ action: "start", title: "評価", reason }); g.setStreamFailure();
  expect(await g.controller.execute({ action: "say", message: "尾道", reason })).toMatchObject({ error: "agent_failed", savedState: { trip: { id: tripId } } });
});

it("requires a server preview for adoption and invalidates it after a new consultation", async () => {
  const f = fixture(); await f.controller.execute({ action: "start", title: "評価", reason });
  await expect(f.controller.execute({ action: "confirm", reason })).rejects.toThrow("no_adoption_preview");
  const command = { action: "preview", candidateSetId: "candidate:1", candidateSetRevision: 0, variantId: "plan-1", reason };
  const preview = await f.controller.execute(command);
  expect(JSON.stringify(preview)).not.toContain("a".repeat(64));
  expect(await f.controller.execute({ action: "confirm", reason })).toMatchObject({ savedTrip: { revision: 1 } });
  await f.controller.execute(command);
  await f.controller.execute({ action: "say", message: "人数を変更", reason });
  await expect(f.controller.execute({ action: "confirm", reason })).rejects.toThrow("no_adoption_preview");
});

it("limits paid turns, rejects arbitrary commands and never adopts before evaluator input", async () => {
  const f = fixture(1); await f.controller.execute({ action: "start", title: "評価", reason });
  await f.controller.execute({ action: "say", message: "尾道", reason });
  await expect(f.controller.execute({ action: "say", message: "さらに", reason })).rejects.toThrow("turn_budget_exhausted");
  expect(f.streamRequests).toHaveLength(1);
  expect(f.requests.some(r => r.operation === "confirm-plan-adoption")).toBe(false);
  expect(() => parseInteractiveTripCommand({ action: "say", message: "相談", token: "private", reason })).toThrow("invalid_command");
  expect(() => createInteractiveTripSession({ origin: "https://example.test/path", token: async () => "x" })).toThrow("invalid_origin");
});
