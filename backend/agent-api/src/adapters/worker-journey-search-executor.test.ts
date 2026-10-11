import { build } from "esbuild";
import { expect, it } from "vitest";
import { WorkerJourneySearchExecutor } from "./worker-journey-search-executor.js";
it("keeps timers running during CPU work and executes the bundled Domain/verification entry", async () => {
  const bundled = await build({ entryPoints: [new URL("./journey-search-worker-entry.ts", import.meta.url).pathname], bundle: true, platform: "node", target: "node22", format: "cjs", write: false });
  const source = `const until = Date.now() + 100; while (Date.now() < until) {}\n${bundled.outputFiles![0]!.text}`;
  let ticks = 0; const timer = setInterval(() => ticks++, 5);
  try {
    const searched = await new WorkerJourneySearchExecutor(source).execute({ serviceDate: "2026-10-12", originStation: "A", destinationStation: "B", departureTimeMinutes: 600 }, {
      index: { schema_version: "direct-service-index-v1", service_date: "2026-10-12", services: { one: { service_uid: "one", train_no: "1M", calls: [{ station_name: "A", departure_time_minutes: 600 }, { station_name: "B", arrival_time_minutes: 620 }] } } },
    }, "2026-10-11T10:00:00Z");
    expect(ticks).toBeGreaterThan(5); expect(searched.result.journeys).toHaveLength(1); expect(searched.items).toHaveLength(1);
  } finally { clearInterval(timer); }
});
it("terminates a stuck worker and permits the next independent invocation", async () => {
  await expect(new WorkerJourneySearchExecutor("while (true) {}", 30).execute({} as never, {} as never, "")).rejects.toThrow("deadline exceeded");
  await expect(new WorkerJourneySearchExecutor('require("node:worker_threads").parentPort.postMessage({ result: {}, items: [] })').execute({} as never, {} as never, "")).resolves.toEqual({ result: {}, items: [] });
});

it("terminates CPU work when its Tool is cancelled", async () => {
  const controller = new AbortController();
  const running = new WorkerJourneySearchExecutor("while (true) {}", 1_000).execute({} as never, {} as never, "", controller.signal);
  controller.abort(); await expect(running).rejects.toThrow("cancelled");
});
