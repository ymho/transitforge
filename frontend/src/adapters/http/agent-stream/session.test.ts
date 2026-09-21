import { expect, it, vi } from "vitest";
import { createConversationStreamSession, type ConversationStreamReferences } from "./session";
import type { AuthSession, AuthState } from "../../../usecases/auth/auth-session";

const frame = (seq: number, event: object) => `event: agent\ndata: ${JSON.stringify({ v: 1, runId: "run", seq, event })}\n\n`;
const progress = frame(1, { type: "progress", phase: "running" });
const finish = frame(2, { type: "final", status: "completed", response: "保存された回答" }) + 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n';
function setup() {
  let state: AuthState = { status: "signed-in", displayName: "A" };
  const listeners = new Set<(state: AuthState) => void>();
  const changeAuth = (next: AuthState = { status: "signed-in", displayName: "B" }) => { state = next; listeners.forEach(l => l(state)); };
  const auth: AuthSession = { initialize: async () => {}, getState: () => state, getAccessToken: vi.fn(async () => "access-token"),
    subscribe: l => { listeners.add(l); l(state); return () => { listeners.delete(l); }; },
    login: async () => {}, logout: async () => changeAuth({ status: "signed-out" }), invalidate: vi.fn(() => changeAuth({ status: "expired" })),
  };
  const refs: ConversationStreamReferences = { conversationId: "conversation-a", tripId: "trip-a", itemId: "item-a", tripRevision: 1 };
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ start(c) { stream = c; c.enqueue(new TextEncoder().encode(progress)); } }), { headers: { "content-type": "text/event-stream" } }));
  const newTurnId = vi.fn(() => `turn-${newTurnId.mock.calls.length}`);
  const session = createConversationStreamSession({ auth, references: () => refs, fetcher, newTurnId });
  const complete = () => { stream.enqueue(new TextEncoder().encode(finish)); stream.close(); };
  return { auth, refs, fetcher, session, changeAuth, complete, newTurnId };
}
it("sends only references/raw request and Bearer; a communication retry retains the turn ID", async () => {
  const s = setup(); Object.assign(s.refs, { history: "PRIVATE", profile: "PRIVATE", trip: "PRIVATE", tools: ["PRIVATE"] });
  const action = s.session.start("相談");
  s.fetcher.mockRejectedValueOnce(new Error("network"));
  await expect(action.send()).rejects.toThrow("stream_error");
  const pending = action.send(); await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(2)); s.complete();
  expect(await pending).toBe("保存された回答");
  const bodies = s.fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(bodies[0]).toEqual({ conversationId: "conversation-a", turnId: "turn-1", userRequest: "相談", tripId: "trip-a", uiContext: { itemId: "item-a" } });
  expect(bodies[1]).toEqual(bodies[0]); expect(s.newTurnId).toHaveBeenCalledTimes(1);
  expect(s.fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer access-token" });
  expect(s.session.start("次の相談").request.turnId).toBe("turn-2"); s.session.dispose();
});
it.each(["logout", "account", "conversation", "trip", "draft", "turn"])("rejects delayed final after %s and aborts reception", async change => {
  const s = setup(), events = vi.fn(); const action = s.session.start("相談"); const pending = action.send(events);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(1));
  if (change === "logout") await s.auth.logout();
  if (change === "account") s.changeAuth();
  if (change === "conversation") { s.refs.conversationId = "conversation-b"; s.session.contextChanged(); }
  if (change === "trip") { s.refs.tripId = "trip-b"; s.session.contextChanged(); }
  if (change === "draft") { s.refs.draftRevision = 2; s.session.contextChanged(); }
  if (change === "turn") s.session.start("新しい相談");
  expect(s.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  s.complete(); await rejection;
  expect(events.mock.calls.map(([e]) => e.type)).toEqual(["progress"]);
  await expect(action.send()).rejects.toThrow("stale_generation"); s.session.dispose();
});
it.each([401, 403])("handles %s without refresh or fallback", async status => {
  const s = setup(); s.fetcher.mockResolvedValue(new Response("{}", { status }));
  await expect(s.session.start("相談").send()).rejects.toMatchObject({ code: status === 401 ? "unauthenticated" : "forbidden" });
  expect(s.fetcher).toHaveBeenCalledTimes(1); expect(s.auth.invalidate).toHaveBeenCalledTimes(status === 401 ? 1 : 0); s.session.dispose();
});
it("does not send a request if the account changes while obtaining the token", async () => {
  const s = setup(); vi.mocked(s.auth.getAccessToken).mockImplementation(async () => { s.changeAuth(); return "old-token"; });
  await expect(s.session.start("相談").send()).rejects.toThrow("stale_generation");
  expect(s.fetcher).not.toHaveBeenCalled(); s.session.dispose();
});
it("never invalidates the new account after a delayed old 401", async () => {
  const s = setup(); s.fetcher.mockImplementation(async () => { s.changeAuth(); return new Response("{}", { status: 401 }); });
  await expect(s.session.start("相談").send()).rejects.toThrow("stale_generation");
  expect(s.auth.invalidate).not.toHaveBeenCalled(); s.session.dispose();
});
it.each([progress, progress + frame(2, { type: "error", code: "agent_failed" }) + 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n'])("rejects missing final and stream errors", async text => {
  const s = setup(); s.fetcher.mockResolvedValue(new Response(text, { headers: { "content-type": "text/event-stream" } }));
  const event = vi.fn(); await expect(s.session.start("相談").send(event)).rejects.toThrow();
  expect(event.mock.calls.some(([e]) => e.type === "final")).toBe(false); s.session.dispose();
});
it("receives a public proposal as structured UI data only after a complete stream", async () => {
  const s = setup();
  const tripUpdateProposal = { tripId: "11111111-1111-4111-8111-111111111111", baseRevision: 0, summary: "条件案", patches: [{ type: "request", request: { constraints: [], assumptions: [] } }] };
  s.fetcher.mockResolvedValueOnce(new Response(progress + frame(2, { type: "final", status: "completed", response: "案を確認", tripUpdateProposal }) + 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n', { headers: { "content-type": "text/event-stream" } }));
  expect(await s.session.start("相談").send()).toEqual({ text: "案を確認", tripUpdateProposal }); s.session.dispose();
});
it("rejects malformed proposal data without displaying a partial final", async () => {
  const s = setup(), onEvent = vi.fn();
  s.fetcher.mockResolvedValueOnce(new Response(progress + frame(2, { type: "final", status: "completed", response: "案", tripUpdateProposal: { trace: "private" } }) + 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n', { headers: { "content-type": "text/event-stream" } }));
  await expect(s.session.start("相談").send(onEvent)).rejects.toThrow("invalid_event");
  expect(onEvent.mock.calls.some(([e]) => e.type === "final")).toBe(false); s.session.dispose();
});
it("receives a separate bounded consultation proposal and rejects ambiguous or invalid envelopes", async () => {
  const s = setup(), baseRequest = { constraints: [], assumptions: [] };
  const consultationRequestProposal = { conversationId: "11111111-1111-4111-8111-111111111111", baseRequest, request: { ...baseRequest, goal: "美術館" }, summary: "条件案" };
  const respond = (extra: object) => new Response(progress + frame(2, { type: "final", status: "completed", response: "案", ...extra }) + 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n', { headers: { "content-type": "text/event-stream" } });
  s.fetcher.mockResolvedValueOnce(respond({ consultationRequestProposal }));
  expect(await s.session.start("相談").send()).toEqual({ text: "案", consultationRequestProposal });
  for (const extra of [{ consultationRequestProposal: { ...consultationRequestProposal, trace: "private" } }, { consultationRequestProposal, tripUpdateProposal: {} }]) {
    s.fetcher.mockResolvedValueOnce(respond(extra)); await expect(s.session.start("相談").send()).rejects.toThrow();
  }
  s.session.dispose();
});
it("retains both cost and condition review proposals without promoting either to a saved Trip", async () => {
  const s = setup();
  const { costForecast } = await import("../../../../../modules/trip/domain/trip-costs.fixture");
  const forecast = costForecast(), tripCostProposal = { tripId: forecast.tripId, baseRevision: 0, summary: "概算", patches: [{ type: "cost_forecast", forecast }] };
  const tripUpdateProposal = { tripId: forecast.tripId, baseRevision: 0, summary: "条件", patches: [{ type: "request", request: { constraints: [], assumptions: [] } }] };
  s.fetcher.mockResolvedValueOnce(new Response(progress + frame(2, { type: "final", status: "completed", response: "案を確認", tripCostProposal, tripUpdateProposal }) + 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n', { headers: { "content-type": "text/event-stream" } }));
  expect(await s.session.start("概算して").send()).toEqual({ text: "案を確認", tripCostProposal, tripUpdateProposal }); s.session.dispose();
});
