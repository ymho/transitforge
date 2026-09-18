// PoC uses the production transport; fixture/scenario selection stays isolated here.
import { createAgentStreamHandler as createHandler } from "../agent-stream-handler.js";
export type { ObservedAgentRun, StreamRequest, StreamWriter } from "../agent-stream-handler.js";
export function createAgentStreamHandler(options: Omit<Parameters<typeof createHandler>[0], "path">) {
  return createHandler({ ...options, path: "/api/agent-stream-poc" });
}
