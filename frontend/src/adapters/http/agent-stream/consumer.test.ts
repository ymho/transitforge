import { expect, it, vi } from "vitest";
import { consumeAgentStream, SseFrameParser, type StreamMeasurement } from "./consumer";
const frame = (seq: number, event: unknown) => `event: agent\ndata: ${JSON.stringify({ v: 1, runId: "run", seq, event })}\n\n`;
const final = frame(2, { type: "final", status: "completed", response: "日本語の回答" });
const progress = frame(1, { type: "progress", phase: "running" });
const done = 'event: done\ndata: {"v":1,"runId":"run","seq":3}\n\n';
function stream(text: string, split = false) {
  const data = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (split) for (const byte of data) controller.enqueue(Uint8Array.of(byte)); else controller.enqueue(data);
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}
function setup(response: Response) {
  const controller = new AbortController(), onEvent = vi.fn(), fetcher = vi.fn(async () => response);
  const measurement: StreamMeasurement = { requestStart: 0, maxSilenceMs: 0 };
  return { token: "fixture", request: { userRequest: "質問" }, signal: controller.signal, isCurrent: () => true, onEvent, fetcher, measurement };
}
it.each([true, false])("handles UTF-8 byte splits and coalesced events (split=%s)", async split => {
  const options = setup(stream(progress + ': heartbeat\n\n' + final + done, split));
  await consumeAgentStream(options);
  expect(options.onEvent.mock.calls.map(([e]) => e.type)).toEqual(["progress", "final"]);
  expect(options.onEvent).toHaveBeenLastCalledWith({ type: "final", status: "completed", response: "日本語の回答" });
  expect(options.measurement.ttfiMs).toBeDefined(); expect(options.fetcher).toHaveBeenCalledOnce();
});
it.each([progress + final, progress + done, progress + final + done.slice(0, -1), progress + final + done + progress])("rejects incomplete/out-of-order streams", async text => {
  const options = setup(stream(text)); await expect(consumeAgentStream(options)).rejects.toThrow();
  expect(options.onEvent.mock.calls.some(([e]) => e.type === "final")).toBe(false);
});
it("treats error+done as failure even under HTTP 200", async () => {
  await expect(consumeAgentStream(setup(stream(progress + frame(2, { type: "error", code: "agent_failed" }) + done)))).rejects.toThrow("agent_failed");
});
it.each(["account", "conversation", "trip"])("discards events after %s generation changes", async () => {
  const options = setup(stream(progress + final + done)); let generation = 1;
  options.isCurrent = () => generation === 1; options.onEvent.mockImplementation(() => { generation++; });
  await expect(consumeAgentStream(options)).rejects.toThrow("stale_generation");
  expect(options.onEvent).toHaveBeenCalledOnce();
});
it("handles abort before fetch and never retries an interrupted request", async () => {
  const options = setup(stream(progress)); const controller = new AbortController(); controller.abort();
  await expect(consumeAgentStream({ ...options, signal: controller.signal })).rejects.toThrow("aborted");
  expect(options.fetcher).not.toHaveBeenCalled();
});
it("bounds frames, rejects malformed UTF-8, supports split CRLF/multiline data", () => {
  const emit = vi.fn(), parser = new SseFrameParser(emit);
  parser.push(new TextEncoder().encode('event: example\r\ndata: one\r\n')); parser.push(new TextEncoder().encode('data: two\r\n\r\n')); parser.finish();
  expect(emit).toHaveBeenCalledWith("example", "one\ntwo");
  expect(() => new SseFrameParser(emit).push(new TextEncoder().encode('x'.repeat(65_537)))).toThrow("frame_too_large");
  expect(() => new SseFrameParser(emit).push(Uint8Array.of(0xff))).toThrow();
});
it("enforces idle timeout and measures silence on abort without retry", async () => {
  vi.useFakeTimers();
  try {
    const options = setup(stream(""));
    const fetcher: typeof fetch = vi.fn(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(progress));
      init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    } }), { headers: { "content-type": "text/event-stream" } }));
    const pending = expect(consumeAgentStream({ ...options, fetcher, idleMs: 100, now: () => Date.now() })).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(101); await pending;
    expect(options.measurement.maxSilenceMs).toBe(100);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it.each([
  [stream(""), "incomplete_stream"],
  [stream('event: agent\ndata: {\n\n'), "stream_error"],
  [new Response("", { status: 401 }), "http_401"],
  [new Response("<html>forbidden</html>", { status: 403 }), "http_403"],
  [new Response("", { status: 500 }), "http_500"],
] as const)("normalizes empty/invalid/error responses without a final (%s)", async (response, code) => {
  const options = setup(response);
  await expect(consumeAgentStream(options)).rejects.toThrow(code);
  expect(options.onEvent).not.toHaveBeenCalled();
  expect(options.measurement.error).toBe(code);
  expect(options.fetcher).toHaveBeenCalledOnce();
});
