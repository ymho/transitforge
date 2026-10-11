import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { AgentStreamError, validEvent } from "./consumer";
/** Reads the exact persisted turn. Never starts or replays Agent execution. */
export async function recoverConversationTurn(options: {
  token: string; conversationId: string; turnId: string; signal: AbortSignal;
  isCurrent: () => boolean; fetcher?: typeof fetch; deadlineMs: number; pollMs?: number;
}): Promise<Extract<AgentTurnEvent, { type: "final" }> | undefined> {
  const until = performance.now() + options.deadlineMs;
  while (performance.now() < until) {
    if (options.signal.aborted || !options.isCurrent()) throw new AgentStreamError("stale_generation");
    const response = await (options.fetcher ?? fetch)("/api/conversations/v1", {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: "conversation-api-v1", operation: "turn", conversationId: options.conversationId, turnId: options.turnId }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.ceil(Math.min(10_000, Math.max(1, until - performance.now()))))]),
    });
    if (options.signal.aborted || !options.isCurrent()) throw new AgentStreamError("stale_generation");
    if (!response.ok) return undefined;
    const value = await response.json();
    if (options.signal.aborted || !options.isCurrent()) throw new AgentStreamError("stale_generation");
    if (value.version !== "conversation-api-v1") return undefined;
    if (value.state === "completed") {
      const event = { type: "final", ...value.result };
      if (!validEvent(event) || event.type !== "final") throw new AgentStreamError("invalid_event");
      return event;
    }
    if (value.state !== "pending") return undefined;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); options.signal.removeEventListener("abort", abort); reject(new AgentStreamError("stale_generation")); };
      const timer = setTimeout(() => { options.signal.removeEventListener("abort", abort); resolve(); }, Math.min(options.pollMs ?? 2_000, Math.max(1, until - performance.now())));
      options.signal.addEventListener("abort", abort, { once: true });
    });
  }
  return undefined;
}
