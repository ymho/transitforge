import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { lambdaStreamHandler, type LambdaStreamingApi, type RestStreamEvent } from "./lambda.js";
it("keeps REST event and Lambda prelude in the adapter and honors backpressure callbacks", async () => {
  const frames: string[] = [], metadata = vi.fn((_raw: Writable, value: unknown) => { frames.push(JSON.stringify(value), "\0".repeat(8)); return _raw; });
  const raw = new Writable({ write(chunk, _encoding, callback) { frames.push(String(chunk)); setTimeout(callback, 1); } });
  const api: LambdaStreamingApi = { streamifyResponse: handler => handler, HttpResponseStream: { from: metadata } };
  const handler = lambdaStreamHandler(api, async (request, writer) => {
    expect(request).toMatchObject({ method: "POST", path: "/api/agent-stream-poc", body: "{}", apiRequestId: "gateway-1", lambdaRequestId: "lambda-1" });
    writer.start(401, { "cache-control": "no-store" }); await writer.write('{"error":"unauthenticated"}'); await writer.end();
  }) as (event: RestStreamEvent, output: Writable, context?: { awsRequestId?: string }) => Promise<void>;
  const context = { awsRequestId: "lambda-1", callbackWaitsForEmptyEventLoop: true };
  await handler({ httpMethod: "POST", path: "/api/agent-stream-poc", body: "{}", requestContext: { extendedRequestId: "gateway-1" } }, raw, context);
  expect(context.callbackWaitsForEmptyEventLoop).toBe(false);
  expect(metadata).toHaveBeenCalledOnce(); expect(frames[1]).toBe("\0".repeat(8));
  expect(raw.writableFinished).toBe(true);
});
