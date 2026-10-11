import { Worker } from "node:worker_threads";
import type { JourneySearchExecutor } from "../ports/journey-search-executor.js";
import workerSource from "./journey-search-worker-source.js";
/** Each request owns its worker; termination cannot poison a later request. */
export class WorkerJourneySearchExecutor implements JourneySearchExecutor {
  constructor(private readonly source = workerSource, private readonly timeoutMs = 85_000) {}
  execute: JourneySearchExecutor["execute"] = (request, input, retrievedAt, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Journey search cancelled")); return; }
    if (!this.source) { reject(new Error("Journey worker is not bundled")); return; }
    const worker = new Worker(this.source, { eval: true, workerData: { request, input, retrievedAt } });
    let settled = false;
    const finish = (error?: Error, value?: Awaited<ReturnType<JourneySearchExecutor["execute"]>>) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      void worker.terminate().then(() => { if (error) reject(error); else resolve(value!); }, reject);
    };
    const abort = () => finish(new Error("Journey search cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => finish(new Error("Journey search deadline exceeded")), this.timeoutMs);
    worker.once("message", value => finish(undefined, value));
    worker.once("error", error => finish(error));
    worker.once("exit", () => finish(new Error("Journey worker exited without a result")));
  });
}
