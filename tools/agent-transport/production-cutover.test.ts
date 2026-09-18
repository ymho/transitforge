/** Local Chromium + real stream/turn/context/runtime/presentation. No AWS or paid model. */
import { expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { build } from "esbuild";
import { createProductionAgentStream } from "../../backend/agent-api/src/agent-stream-composition.js";
import { createProductionConversationAgent } from "../../backend/agent-api/src/composition/production-conversation-agent.js";
import { productionServerTools } from "../../backend/agent-api/src/composition/production-server-tools.js";
import { createFixedEgressAccommodationOperation } from "../../backend/agent-api/src/composition/fixed-egress-accommodation.js";
import { createFixedEgressProviderHandler } from "../../backend/agent-api/src/adapters/fixed-egress-provider-handler.js";
import { BedrockConversationModel } from "../../backend/agent-api/src/adapters/bedrock-conversation-model.js";
import { stateDynamoFixture, conversationId, secondId } from "../../backend/agent-api/src/adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../../backend/agent-api/src/adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../../backend/agent-api/src/adapters/cognito-token.fixture.js";
import { createTrip } from "@raiquora/trip/trip";

it("authenticated persisted fixed-egress turn reaches Chromium chat, replays, conflicts, and fences stale streams", async () => {
  const modulePath = process.env.PLAYWRIGHT_MODULE ?? "/tmp/raiquora-ui-verification/node_modules/playwright/index.mjs";
  const { chromium } = await import(/* @vite-ignore */ modulePath);
  const { verifier } = cognitoTokenFixture(); const principal = await verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(principal, createTrip(secondId, "server trip", "2026-09-18T00:00:00Z"));
  let release: (() => void) | undefined, hold = false, dropFinal = false, toolFailure = false;
  const provider = createFixedEgressProviderHandler({ search: async () => {
    if (toolFailure) throw new Error("private tool failure");
    return [{ kind: "accommodation", provider: "travel-provider", providerItemId: "42", name: "宿",
      checkInDate: "2026-10-01", checkOutDate: "2026-10-02", availability: "unknown" }];
  } });
  const invoke = vi.fn(async (input: { Payload: Uint8Array }) => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify(await provider(JSON.parse(new TextDecoder().decode(input.Payload))))) }));
  const modelCalls = vi.fn(); const bodies: Record<string, unknown>[] = [];
  const handle = createProductionAgentStream({ enabled: true, path: "/api/agent-stream", verifier, log: () => {},
    createApplication: executionId => {
      let calls = 0;
      return createProductionConversationAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
        newExecutionId: () => executionId, weather: { search: vi.fn() }, additionalTools: productionServerTools({ external: {}, journey: vi.fn(),
          accommodation: createFixedEgressAccommodationOperation("provider-arn", { invoke }) }),
        model: new BedrockConversationModel({ converse: async request => {
          modelCalls(request); calls++;
          if (hold && calls === 1) await new Promise<void>(resolve => { release = resolve; });
          if (toolFailure && calls > 1) throw new Error("private model failure");
          return calls === 1 ? { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "accommodation", name: "search_accommodations",
            input: { destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02" } } }] } }, stopReason: "tool_use" }
            : { output: { message: { role: "assistant", content: [{ text: '<decision_summary>{"interpretedGoal":"宿を調べる","hardConstraints":[],"softPreferences":[],"selectedAction":"answer","unresolvedFacts":[],"reasonCodes":["evidence_sufficient"],"usedEvidenceIds":["accommodation:travel-provider:42"]}</decision_summary>保存済みの宿泊回答です。空室は未確認です。' }] } }, stopReason: "end_turn" };
        } }, { modelId: "fake", systemPrompt: "offline" }),
      });
    },
  });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { createConversationStreamSession } from "./frontend/src/adapters/http/agent-stream/session.ts";
    import { configureAiGuidePanel } from "./frontend/src/presentation/concierge/ai-guide-panel.ts";
    import { LocalConversationHistoryRepository } from "./frontend/src/adapters/browser/conversation-history-repository.ts";
    const refs = { conversationId: "${conversationId}", tripId: "${secondId}" };
    let authState = {status:"signed-in", displayName:"A"}; const listeners = new Set();
    let accessToken = ${JSON.stringify(token())};
    const auth = {getState:()=>authState, getAccessToken:async()=>accessToken,
      subscribe:l=>{listeners.add(l);l(authState);return()=>listeners.delete(l);}, invalidate:()=>{}, initialize:async()=>{},login:async()=>{},logout:async()=>{}};
    const session = createConversationStreamSession({auth,references:()=>refs});
    const el = tag => document.body.appendChild(document.createElement(tag));
    const messages = el("div"), input = el("input"), form = el("form"); messages.id = "messages";
    localStorage.setItem("PRIVATE_PROFILE", "NEVER_SEND");
    const panel = configureAiGuidePanel({ conversationSessionId: refs.conversationId, panel: el("div"), toggle: el("button"), close:el("button"),
      messages, form, input, submit:el("button"), suggestions:[],contextChoices:el("div"),settingsToggle:el("button"),settingsPanel:el("div"),
      transferPace:el("select"),rankingPreference:el("select"),storage:localStorage,historyRepository:new LocalConversationHistoryRepository(sessionStorage),
      responseContextKey:()=>session.contextVersion()
    }, prompt => { window.action = session.start(prompt); return window.action.send(); });
    window.test = {ask:()=>panel.ask("京都の宿を調べたい"), session, refs,
      switch:(kind)=>{ if(kind==="logout"||kind==="account") {authState={status:kind==="logout"?"signed-out":"signed-in", displayName:"B"};listeners.forEach(l=>l(authState));}
        else if(kind==="conversation")refs.conversationId=crypto.randomUUID();else if(kind==="trip")refs.tripId=crypto.randomUUID();else session.start("next");session.contextChanged(); },
      setToken:token=>{accessToken=token;}, send:()=>{window.action=session.start("京都の宿を調べたい");return window.action.send();}};
  `, loader: "ts" }, bundle: true, format: "esm", write: false });
  const harnessErrors: unknown[] = [];
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><script type="module" src="/browser.js"></script>'); return; }
    if (req.url === "/browser.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const controller = new AbortController(); res.on("close", () => { if (!res.writableFinished) controller.abort(); });
    await handle({ method: req.method, path: req.url, headers: req.headers as Record<string, string>, body }, {
      signal: controller.signal, start: (status, headers) => {
        // Only inspect a body after the real handler has authenticated and validated it.
        // Browser favicon requests and malformed/empty POSTs must reach its 404/400 contract.
        if (status === 200) bodies.push(JSON.parse(body));
        res.writeHead(status, headers); res.flushHeaders();
      },
      write: async frame => {
        if (frame.includes('"type":"final"')) {
          expect([...state.records.values()].some(row => row.sk.S?.startsWith("TURN#") && row.payload.S?.includes("completed"))).toBe(true);
          if (dropFinal) return;
        }
        res.write(frame);
      }, end: async () => { res.end(); },
    });
  };
  const server = createServer((req, res) => {
    // Node does not await async request listeners. Report unexpected failures to the test,
    // while giving the client a bounded response (or a failed stream after headers).
    void serve(req, res).catch(error => {
      harnessErrors.push(error);
      if (res.headersSent) res.destroy();
      else { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"request_failed"}'); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no address");
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) }); const page = await browser.newPage({ reducedMotion: "reduce" });
  const url = `http://127.0.0.1:${address.port}`;
  const load = async () => { await page.goto(url); await page.waitForFunction(() => Boolean((window as any).test)); };
  try {
    await load();
    const beforeInvalid = state.commands.length;
    for (const [path, method, body, status] of [
      ["/favicon.ico", "GET", undefined, 404],
      ["/api/agent-stream", "POST", "", 400],
      ["/api/agent-stream", "POST", '{"userRequest":', 400],
    ] as const) {
      const rejected = await page.evaluate(async ({ path, method, body, jwt }) => {
        const response = await fetch(path, { method, body, headers: { "content-type": "application/json", Authorization: `Bearer ${jwt}` } });
        return { status: response.status, body: await response.json() };
      }, { path, method, body, jwt: token() });
      expect(rejected).toEqual({ status, body: { error: "request_failed" } });
    }
    expect(state.commands).toHaveLength(beforeInvalid);
    expect(modelCalls).not.toHaveBeenCalled();
    await page.evaluate(() => (window as any).test.ask());
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent?.includes("宿泊候補「宿」"));
    expect(modelCalls).toHaveBeenCalledTimes(2); expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(modelCalls.mock.calls)).toContain("server trip");
    expect(Object.keys(bodies[0]).sort()).toEqual(["conversationId", "tripId", "turnId", "userRequest"]);
    expect(JSON.stringify(bodies)).not.toMatch(/NEVER_SEND|PRIVATE_PROFILE|messages|tools|principal/);
    expect(await page.evaluate(() => (window as any).action.send())).toContain("宿泊候補"); expect(modelCalls).toHaveBeenCalledTimes(2);
    const conflict = await page.evaluate(async (authorization: string) => {
      const request = {...(window as any).action.request, userRequest:"different"};
      const response = await fetch("/api/agent-stream", {method:"POST",headers:{"content-type":"application/json",Authorization:authorization},body:JSON.stringify(request)});
      return response.text();
    }, "Bearer " + token());
    expect(conflict).toContain("turn_conflict");
    for (const [jwt, code] of [[token({exp:1}), "unauthenticated"], [token({scope:"other"}), "forbidden"]]) {
      const before = state.commands.length;
      await page.evaluate((jwt: string) => (window as any).test.setToken(jwt), jwt);
      expect(await page.evaluate(() => (window as any).test.send().catch((e: Error & {code?: string}) => e.code ?? e.message))).toBe(code);
      expect(state.commands).toHaveLength(before);
    }
    for (const kind of ["logout", "account", "conversation", "trip", "turn"]) {
      await load(); hold = true; release = undefined;
      await page.evaluate(() => { (window as any).pending = (window as any).test.send().then(() => "final", (e: Error) => e.message); });
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await page.evaluate((kind: string) => (window as any).test.switch(kind), kind); hold = false; release!();
      expect(await page.evaluate(() => (window as any).pending)).not.toBe("final");
    }
    await load(); dropFinal = true;
    expect(await page.evaluate(() => (window as any).test.send().catch((e: Error) => e.message))).toMatch(/missing_final|incomplete_stream|invalid_sequence/); dropFinal = false;
    await load(); toolFailure = true;
    expect(await page.evaluate(() => (window as any).test.send().catch((e: Error) => e.message))).toBe("agent_failed");
  } finally { release?.(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  expect(harnessErrors).toEqual([]);
}, 60_000);
