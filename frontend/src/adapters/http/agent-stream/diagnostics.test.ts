import { expect, it, vi } from "vitest";
import { createBrowserAgentDiagnostics } from "./diagnostics";
import type { AuthSession, AuthState } from "../../../usecases/auth/auth-session";

function setup() {
  let state: AuthState = { status: "signed-in", displayName: "A" }, clock = Date.parse("2026-10-11T08:00:00Z"), id = 0;
  const listeners = new Set<(state: AuthState) => void>();
  const auth = { getState: () => state, subscribe: (listener: (state: AuthState) => void) => { listeners.add(listener); listener(state); return () => listeners.delete(listener); }, getAccessToken: vi.fn(), refreshAccessToken: vi.fn(), invalidate: vi.fn() } as unknown as AuthSession;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  const diagnostics = createBrowserAgentDiagnostics({ auth, buildId: "e0d06e68", fetcher, now: () => clock, newId: () => `${String(++id).padStart(8, "0")}-1111-4111-8111-111111111111` });
  const record = () => diagnostics.record(new Error("PRIVATE utterance or token"), { requestStart: 0, maxSilenceMs: 45000, settledMs: 45100, requestSent: true, httpStatus: 200, abortReason: "idle_timeout", headersMs: 50, ttfbMs: 100 });
  return { auth, fetcher, diagnostics, record, advance: (ms: number) => clock += ms, change: () => { state = { status: "signed-in", displayName: "B" }; listeners.forEach(listener => listener(state)); } };
}
it("projects only bounded metadata and never acquires/refreshes/invalidates authentication", async () => {
  const s = setup(); s.diagnostics.authorize("access-token"); s.record();
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledOnce());
  const request = s.fetcher.mock.calls[0]!;
  expect(request[0]).toBe("/api/conversations/diagnostics/v1");
  expect(request[1]?.headers).toMatchObject({ Authorization: "Bearer access-token" });
  const body = String(request[1]?.body);
  expect(body).not.toMatch(/PRIVATE|access-token|displayName|userRequest/);
  expect(JSON.parse(body).reports[0]).toMatchObject({ code: "unknown_error", abortReason: "idle_timeout", httpStatus: 200, elapsedMs: 45100, firstByteMs: 100 });
  expect(s.auth.getAccessToken).not.toHaveBeenCalled(); expect(s.auth.refreshAccessToken).not.toHaveBeenCalled(); expect(s.auth.invalidate).not.toHaveBeenCalled(); s.diagnostics.dispose();
});
it("buffers at most eight reports, sends at most four once, and expires reports after thirty minutes", async () => {
  const s = setup(); for (let i = 0; i < 12; i++) s.record();
  expect(s.fetcher).not.toHaveBeenCalled(); s.diagnostics.authorize("token");
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledOnce());
  const batch = JSON.parse(String(s.fetcher.mock.calls[0]![1]?.body)).reports;
  expect(batch).toHaveLength(4); expect(batch[0].diagnosticId).toMatch(/^00000005-/u);
  s.advance(1_800_001); s.diagnostics.flush(); await Promise.resolve(); expect(s.fetcher).toHaveBeenCalledOnce(); s.diagnostics.dispose();
});
it("retains a network failure for only one later opportunity and never immediately retries", async () => {
  const s = setup(); s.fetcher.mockRejectedValue(new Error("offline")); s.diagnostics.authorize("token"); s.record();
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledOnce()); await Promise.resolve();
  s.diagnostics.flush(); await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(2)); await Promise.resolve();
  s.diagnostics.flush(); expect(s.fetcher).toHaveBeenCalledTimes(2); s.diagnostics.dispose();
});
it("discards previous-account reports/tokens and delayed reports from the old authentication generation", async () => {
  const s = setup(), epoch = s.diagnostics.contextVersion(); s.record(); s.change();
  s.diagnostics.authorize("new-token"); s.diagnostics.record(new Error("aborted"), { requestStart: 0, maxSilenceMs: 0 }, undefined, epoch);
  s.diagnostics.flush(); await Promise.resolve(); expect(s.fetcher).not.toHaveBeenCalled(); s.diagnostics.dispose();
});
it("does not invalidate auth or retry a rejected diagnostic request", async () => {
  const s = setup(); s.fetcher.mockResolvedValue(new Response(null, { status: 401 })); s.diagnostics.authorize("token"); s.record();
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledOnce()); await Promise.resolve();
  s.diagnostics.flush(); expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.auth.invalidate).not.toHaveBeenCalled(); s.diagnostics.dispose();
});
it("aborts an in-flight diagnostic upload on authentication changes", async () => {
  const s = setup(); let finish!: (response: Response) => void;
  s.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  s.diagnostics.authorize("old-token"); s.record();
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledOnce());
  const signal = s.fetcher.mock.calls[0]![1]?.signal;
  s.change(); expect(signal?.aborted).toBe(true);
  finish(new Response(null, { status: 200 })); await Promise.resolve(); s.diagnostics.dispose();
});
it("caps a stalled diagnostic upload at five seconds without a retry loop", async () => {
  vi.useFakeTimers();
  const s = setup();
  try {
    s.fetcher.mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
    s.diagnostics.authorize("token"); s.record();
    expect(s.fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5001);
    expect(s.fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.auth.invalidate).not.toHaveBeenCalled();
  } finally { s.diagnostics.dispose(); vi.useRealTimers(); }
});
