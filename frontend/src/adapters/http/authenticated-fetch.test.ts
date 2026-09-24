import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedFetch } from "./authenticated-fetch";
import { HttpServerTripClient } from "./server-trip-client";
import { ApiAuthenticationError } from "../../usecases/auth/api-authentication-error";
import type { AuthSession, AuthState } from "../../usecases/auth/auth-session";
import { createTrip } from "@raiquora/trip/trip";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";

const origin = "https://app.example.test", path = "/api/trips/v1";
function session() {
  let access: string | undefined = "access-A", state: AuthState = { status: "signed-in", displayName: "A" };
  const listeners = new Set<(value: AuthState) => void>();
  const change = (next?: string) => { access = next; state = next ? { status: "signed-in", displayName: next } : { status: "signed-out" }; listeners.forEach(fn => fn(state)); };
  const auth: AuthSession = { initialize: async () => {}, getState: () => state, getAccessToken: vi.fn(async () => access),
    refreshAccessToken: vi.fn(async () => access),
    login: async () => {}, logout: async () => change(), invalidate: vi.fn(() => change()),
    subscribe: fn => { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; } };
  return { auth, change };
}
const post = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "list" }) };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("personal API authenticated fetch", () => {
  it("gets current Access Token for each call, keeps it in a header and disables redirects/cache", async () => {
    const f = session(), network = vi.fn<typeof fetch>().mockImplementation(async () => json({ ok: true }));
    const request = createAuthenticatedFetch(f.auth, origin, network);
    await request(path, post); f.change("access-B"); await request(path, post);
    const calls = network.mock.calls.map(([input]) => input as Request);
    expect(calls.map(r => r.headers.get("authorization"))).toEqual(["Bearer access-A", "Bearer access-B"]);
    expect(calls[0]!.url).toBe(origin + path);
    expect(calls[0]!.redirect).toBe("error"); expect(calls[0]!.cache).toBe("no-store");
    expect(await calls[0]!.text()).not.toMatch(/access-A|id_token/);
    expect(f.auth.getAccessToken).toHaveBeenCalledTimes(2);
    request.dispose();
  });
  it("routes Conversation and Profile through the same-origin Bearer boundary", async () => {
    const f = session(), network = vi.fn<typeof fetch>().mockImplementation(async () => json({ ok: true }));
    const request = createAuthenticatedFetch(f.auth, origin, network);
    for (const endpoint of ["/api/conversations/v1", "/api/profile/v1"]) await request(endpoint, post);
    expect(network.mock.calls.map(([input]) => (input as Request).url)).toEqual([`${origin}/api/conversations/v1`, `${origin}/api/profile/v1`]);
    expect(network.mock.calls.map(([input]) => (input as Request).headers.get("authorization"))).toEqual(["Bearer access-A", "Bearer access-A"]);
    request.dispose();
  });
  it("carries a verified-user token separately from OAC Authorization for remaining Agent operations", async () => {
    const f = session(), network = vi.fn<typeof fetch>().mockImplementation(async () => json({ ok: true }));
    const request = createAuthenticatedFetch(f.auth, origin, network);
    await request("/api/agent", { ...post, headers: { "X-Amz-Content-Sha256": "body-digest" } });
    const sent = network.mock.calls[0]![0] as Request;
    expect(sent.headers.get("x-raiquora-access-token")).toBe("Bearer access-A");
    expect(sent.headers.has("authorization")).toBe(false);
    expect(sent.headers.get("x-amz-content-sha256")).toBe("body-digest");
    await expect(request("/api/agent", { ...post, headers: { "x-raiquora-access-token": "forged" } })).rejects.toThrow("Invalid");
    f.change();
    await expect(request("/api/agent", post)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(network).toHaveBeenCalledOnce(); request.dispose();
  });
  it("never sends requests without login or to streaming/external/query destinations", async () => {
    const f = session(), network = vi.fn<typeof fetch>(), request = createAuthenticatedFetch(f.auth, origin, network);
    for (const url of ["/api/agent-stream", "https://evil.test/api/trips/v1", `${path}?token=secret`, `${path}#secret`, "/api/trips/unknown"]) {
      await expect(request(url, post)).rejects.toThrow("Unsupported");
    }
    await expect(request(path, { ...post, headers: { authorization: "Bearer caller-token" } })).rejects.toThrow("Invalid");
    f.change(); await expect(request(path, post)).rejects.toBeInstanceOf(ApiAuthenticationError);
    expect(network).not.toHaveBeenCalled(); request.dispose();
  });
  it("refreshes and retries one 401, but never hides 403 or business errors", async () => {
    const f = session(), network = vi.fn<typeof fetch>(), request = createAuthenticatedFetch(f.auth, origin, network);
    network.mockResolvedValueOnce(new Response("private claims", { status: 401 }));
    vi.mocked(f.auth.refreshAccessToken).mockResolvedValueOnce("access-B");
    network.mockResolvedValueOnce(json({ ok: true }));
    expect((await request(path, post)).status).toBe(200);
    expect(network.mock.calls.map(([input]) => (input as Request).headers.get("authorization"))).toEqual(["Bearer access-A", "Bearer access-B"]);
    expect(f.auth.refreshAccessToken).toHaveBeenCalledExactlyOnceWith("access-A");
    network.mockResolvedValueOnce(new Response("private claims", { status: 403 }));
    await expect(request(path, post)).rejects.toMatchObject({ code: "forbidden" });
    expect(f.auth.invalidate).not.toHaveBeenCalled(); expect(f.auth.refreshAccessToken).toHaveBeenCalledOnce();
    network.mockResolvedValueOnce(json({ error: "conflict" }, 409));
    expect((await request(path, post)).status).toBe(409);
    expect(network).toHaveBeenCalledTimes(4); request.dispose();
  });
  it("invalidates after a refreshed credential is rejected and never loops", async () => {
    const f = session(), network = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.mocked(f.auth.refreshAccessToken).mockResolvedValueOnce("access-B");
    const request = createAuthenticatedFetch(f.auth, origin, network);
    await expect(request(path, post)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(network).toHaveBeenCalledTimes(2); expect(f.auth.refreshAccessToken).toHaveBeenCalledOnce(); expect(f.auth.invalidate).toHaveBeenCalledOnce();
    request.dispose();
  });
  it("rejects a token lookup that completes after account switch, before network", async () => {
    const f = session(); let resolve!: (value: string) => void;
    vi.mocked(f.auth.getAccessToken).mockReturnValue(new Promise(done => { resolve = done; }));
    const network = vi.fn<typeof fetch>(), request = createAuthenticatedFetch(f.auth, origin, network);
    const pending = request(path, post); f.change("access-B"); resolve("access-A");
    await expect(pending).rejects.toMatchObject({ code: "session-changed" }); expect(network).not.toHaveBeenCalled(); request.dispose();
  });
  it("aborts in-flight work and discards late responses, including body consumption", async () => {
    const f = session(); let finish!: (value: Response) => void;
    const network = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { finish = done; }));
    const request = createAuthenticatedFetch(f.auth, origin, network), pending = request(path, post);
    await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
    f.change(); expect((network.mock.calls[0]![0] as Request).signal.aborted).toBe(true);
    finish(json({ private: "A" })); await expect(pending).rejects.toMatchObject({ code: "session-changed" });
    f.change("access-B");
    let close!: () => void;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"private":"B"}')); close = () => controller.close(); } });
    network.mockResolvedValueOnce(new Response(stream));
    const bodyPending = request(path, post);
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    f.change("access-C"); close();
    await expect(bodyPending).rejects.toMatchObject({ code: "session-changed" }); request.dispose();
  });
  it("keeps uncertain mutation retry bound to its original session and clears cached roles", async () => {
    const f = session(), network = vi.fn<typeof fetch>(), request = createAuthenticatedFetch(f.auth, origin, network);
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "A", "2026-09-18T00:00:00Z");
    const client = new HttpServerTripClient(path, request);
    network.mockResolvedValueOnce(json({ version: "trip-api-v1", trip, role: "owner" }));
    await client.get(trip.id); expect(client.getRole(trip.id)).toBe("owner");
    const mutation = { tripId: trip.id, baseRevision: 0, mutationId: "22222222-2222-4222-8222-222222222222",
      proposal: { tripId: trip.id, baseRevision: 0, summary: "change", patches: [] } };
    network.mockRejectedValueOnce(new Error("response lost"));
    await expect(client.mutate(mutation)).rejects.toThrow("response lost");
    f.change("access-B"); expect(client.getRole(trip.id)).toBeUndefined();
    await expect(client.mutate(structuredClone(mutation))).rejects.toMatchObject({ code: "session-changed" });
    expect(network).toHaveBeenCalledTimes(2); request.dispose();
  });
  it("clears the workspace read view and pending mutation on switch; retry becomes a read", async () => {
    const f = session(), network = vi.fn<typeof fetch>(), request = createAuthenticatedFetch(f.auth, origin, network);
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "A", "2026-09-18T00:00:00Z");
    network.mockImplementation(async () => json({ version: "trip-api-v1", trip, role: "owner" }));
    const client = new HttpServerTripClient(path, request), mutate = vi.fn(async () => { throw new Error("response lost"); });
    const source = createServerTripWorkspaceSource(trip.id, client, { mutate, newMutationId: () => "22222222-2222-4222-8222-222222222222", validateConfirmation: async () => {} });
    const controller = createTripWorkspaceController("conversation"); controller.attach("conversation", source);
    const notify = vi.fn(), unsubscribe = source.subscribe!(notify);
    await source.refresh(); expect(source.getCurrentTrip()?.id).toBe(trip.id);
    controller.propose("old-account proposal", []);
    expect(controller.proposal()).toBeDefined();
    await expect(source.confirmProposal!({ tripId: trip.id, baseRevision: 0, summary: "change", patches: [] })).rejects.toThrow();
    f.change("access-B"); expect(source.getCurrentTrip()).toBeUndefined();
    expect(controller.proposal()).toBeUndefined();
    network.mockResolvedValueOnce(json({ error: "not-found" }, 404));
    await source.retry!(); expect(mutate).toHaveBeenCalledOnce(); expect(source.getCurrentTrip()).toBeUndefined();
    expect(notify).toHaveBeenCalled(); unsubscribe(); request.dispose();
  });
  it("blocks confirmation that finishes after account switch, before generating a mutation", async () => {
    const f = session(), trip = createTrip("11111111-1111-4111-8111-111111111111", "A", "2026-09-18T00:00:00Z");
    const network = vi.fn<typeof fetch>().mockImplementation(async () => json({ version: "trip-api-v1", trip }));
    const request = createAuthenticatedFetch(f.auth, origin, network), client = new HttpServerTripClient(path, request);
    let finish!: () => void;
    const confirmation = vi.fn(() => new Promise<void>(done => { finish = done; })), mutate = vi.fn(), newMutationId = vi.fn();
    const source = createServerTripWorkspaceSource(trip.id, client, { mutate, newMutationId, validateConfirmation: confirmation });
    await source.refresh();
    const pending = source.confirmProposal!({ tripId: trip.id, baseRevision: 0, summary: "change", patches: [] });
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce());
    f.change("access-B"); finish();
    await expect(pending).rejects.toMatchObject({ code: "session-changed" });
    expect(mutate).not.toHaveBeenCalled(); expect(newMutationId).not.toHaveBeenCalled(); request.dispose();
  });
  it("does not expose JSON if the session changes after headers/body have arrived", async () => {
    const f = session(), request = createAuthenticatedFetch(f.auth, origin, vi.fn<typeof fetch>().mockResolvedValue(json({ private: "A" })));
    const response = await request(path, post); f.change("access-B");
    await expect(response.json()).rejects.toMatchObject({ code: "session-changed" }); request.dispose();
  });

});
