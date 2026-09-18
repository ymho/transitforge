/** Local-only real Browser receive measurement. No AWS, model credentials or deployment. */
import { createServer } from "node:http";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { createAgentStreamHandler } from "../../backend/agent-api/src/agent-stream-poc/handler.js";
import { syntheticAgentRun, streamScenarios, type StreamScenario } from "../../backend/agent-api/src/agent-stream-poc/synthetic.js";
import { fakeServerAgentRun } from "../../backend/agent-api/src/agent-stream-poc/fake-server-agent.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "/tmp/raiquora-ui-verification/node_modules/playwright/index.mjs");
const bundle = await build({ entryPoints: ["frontend/src/adapters/http/agent-stream/consumer.ts"], bundle: true, format: "esm", write: false });
const counts = { model: 0, tool: 0 }, completions: string[] = [];
const server = createServer(async (req, res) => {
  if (req.url === "/consumer.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><title>Local transport measurement</title>'); return; }
  if (req.url !== "/api/agent-stream-poc") { res.writeHead(404).end(); return; }
  let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 40_000) { res.writeHead(413).end(); return; } }
  const test = JSON.parse(body).userRequest as string;
  const [mode, name] = test.split(":");
  const scenario = name === "abort" ? "ninety" : name === "wire_missing_final" ? "immediate" : name;
  if (scenario !== "server_agent" && !Object.hasOwn(streamScenarios, scenario)) { res.writeHead(400).end(); return; }
  const controller = new AbortController(); res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  const held: string[] = [];
  const run = scenario === "server_agent" ? fakeServerAgentRun(counts) : syntheticAgentRun(scenario as StreamScenario);
  const handle = createAgentStreamHandler({ newRunId: () => "local-run", heartbeatMs: (scenario === "silent" || scenario === "initial_silent") ? 240_000 : 10_000,
    verifier: { verify: async value => { if (value !== "local-fixture") throw new Error("invalid fixture"); return { subject: "local", identity: { issuer: "local", subject: "local" }, scopes: ["raiquora/user"] }; } },
    run: async (input, emit) => { await run(input, emit); completions.push(test); },
  });
  try { await handle({ method: req.method, path: req.url, headers: req.headers as Record<string, string>, body }, {
    signal: controller.signal,
    start: (status, headers) => { res.writeHead(status, headers); if (mode !== "buffered") res.flushHeaders(); },
    write: async frame => {
      if (name === "wire_missing_final" && (frame.includes('"type":"final"') || frame.includes("event: done"))) return;
      if (mode === "buffered") held.push(frame);
      else await new Promise<void>((resolve, reject) => res.write(frame, error => error ? reject(error) : resolve()));
    },
    end: async () => { if (!res.destroyed) res.end(held.join("")); },
  }); } catch { res.destroy(); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
try {
  const cases = process.env.STREAM_CASES?.split(",") ?? ["stream:immediate", "stream:over30", "stream:ninety", "stream:minutes", "stream:initial_delay", "stream:initial_silent", "stream:silent",
    "stream:mid_error", "stream:abort", "stream:wire_missing_final", "stream:server_agent", "buffered:over30"];
  const results = await Promise.all(cases.map(async test => {
    const context = await browser.newContext();
    await context.addInitScript("globalThis.__name = (fn) => fn"); // tsx evaluation helper
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
    const [result] = await page.evaluate(async (cases: string[]) => {
    const { consumeAgentStream } = await import("/consumer.js");
    return Promise.all(cases.map(async test => {
      const controller = new AbortController(); const received: { type: string; atMs: number }[] = [];
      const metrics = { requestStart: performance.now(), maxSilenceMs: 0 }; let abortTimer;
      if (test.endsWith(":abort")) abortTimer = setTimeout(() => controller.abort(), 1200);
      try { await consumeAgentStream({ token: "local-fixture", request: { userRequest: test }, signal: controller.signal,
        isCurrent: () => true, measurement: metrics, idleMs: 45_000,
        onEvent: (event: { type: string }) => { const node = document.createElement("p"); node.textContent = event.type;
          document.body.appendChild(node); received.push({ type: event.type, atMs: performance.now() - metrics.requestStart }); },
      }); } catch (error) { if (!("error" in metrics)) Object.assign(metrics, { error: String(error) }); }
      clearTimeout(abortTimer); return { case: test, ...metrics, received };
    }));
    }, [test]);
    await context.close(); return result;
  }));
  const report = { measuredAt: new Date().toISOString(), environment: "localhost HTTP, Chromium, synthetic/fake providers; NOT AWS/CDN", browser: browser.version(), counts, completions, results };
  await writeFile(process.argv[2] ?? "/tmp/agent-transport-browser.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  for (const result of results) {
    const expected = result.case.endsWith(":silent") || result.case.endsWith(":abort") ? "aborted"
      : result.case.endsWith(":mid_error") ? "agent_failed"
      : result.case.endsWith(":wire_missing_final") ? "incomplete_stream" : undefined;
    if (result.error !== expected || (!expected && result.completionMs === undefined) ||
        (expected && result.received.some((event: { type: string }) => event.type === "final"))) {
      throw new Error(`Unexpected measurement outcome: ${result.case}`);
    }
  }
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
