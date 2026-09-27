const stops = new Set([
  "endTurn", "toolUse", "stopSequence", "limitTurns", "limitTotalTokens", "limitOutputTokens",
  "maxTokens", "modelContextWindowExceeded", "cancelled", "contentFiltered", "guardrailIntervened", "unknown", "not_recorded",
]);
const reasons = new Set([
  "completed", "failed", "iteration_budget", "total_token_budget", "output_token_budget",
  "model_output_limit", "context_window_limit", "cancelled", "provider_refusal", "tool_budget", "deadline",
]);
const metrics = ["modelCalls", "toolCalls", "inputTokens", "outputTokens", "totalTokens"];

/** Bounded groups of execution events, never raw event objects or identifiers.
 * Every numeric cell is max (measured samples / samples in this group). */
export function executionSummaryRows(events) {
  const groups = new Map();
  for (const event of events) {
    if (!event || event.event !== "agent_diagnostic" || event.phase !== "execution") continue;
    const stop = event.stopReason === undefined ? "not_recorded" : stops.has(event.stopReason) ? event.stopReason : "unknown";
    const reason = reasons.has(event.reason) ? event.reason : "unknown";
    const limit = event.limitReason === "tool_calls" || event.limitReason === "deadline" ? event.limitReason : "-";
    const key = JSON.stringify([reason, stop, limit]);
    const group = groups.get(key) ?? { reason, stop, limit, count: 0, latest: "-",
      metrics: Object.fromEntries(metrics.map(name => [name, { measured: 0, max: undefined }])) };
    group.count++;
    if (typeof event.occurredAt === "string" && Number.isFinite(Date.parse(event.occurredAt))) {
      const occurredAt = new Date(event.occurredAt).toISOString();
      if (occurredAt > group.latest) group.latest = occurredAt;
    }
    for (const name of metrics) {
      const value = event.counts?.[name];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
      const sample = group.metrics[name];
      sample.measured++;
      sample.max = Math.max(sample.max ?? 0, value);
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.latest.localeCompare(left.latest))
    .map(group => [group.reason, group.stop, group.limit, String(group.count), ...metrics.map(name => {
      const sample = group.metrics[name];
      return sample.measured ? `${sample.max} (${sample.measured}/${group.count})` : `not_recorded (0/${group.count})`;
    }), group.latest]);
}
