import { selectedTripItemSnapshot } from "@raiquora/agent/agent-context-snapshot";
import type { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { failedAgentToolResult, successfulAgentToolResult, validAgentToolInput, invalidAgentToolInput, type AgentToolResult } from "@raiquora/agent/tool-contract";
import { stableContractHash } from "@raiquora/agent/output-contract";
import type { Trip } from "@raiquora/trip/trip";

interface TripReadInput { itemIds?: string[]; cursor?: string; limit?: number; expectedRevision?: number }
interface TripReadOutput { contractVersion: "trip-read-v1"; tripId: string; sourceRevision: number;
  items: ReturnType<typeof selectedTripItemSnapshot>[]; coverage: Record<string, unknown>; continuation: string | null }

export function registerTripReadTools(tools: AgentToolRegistry, evidence: ToolEvidenceRegistry, trip: Trip): void {
  tools.register({
    name: "get_trip_items",
    description: "現在のowner-scoped Tripから、ID指定またはrevision-bound cursorで旅程項目を取得する。返却coverageがpartialならcontinuationを使用する。",
    effect: "read",
    prerequisite: ["trusted_trip_scope"],
    requiredCapabilities: ["trip.read"],
    inputSchema: { type: "object", additionalProperties: false, properties: {
      itemIds: { type: "array", items: { type: "string" }, maxItems: 20 }, cursor: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 20 }, expectedRevision: { type: "integer", minimum: 0 },
    } },
    parseInput(value) {
      if (!record(value) || Object.keys(value).some(key => !["itemIds", "cursor", "limit", "expectedRevision"].includes(key)) ||
        value.itemIds !== undefined && (!Array.isArray(value.itemIds) || value.itemIds.length > 20 || value.itemIds.some(id => typeof id !== "string" || !id.trim())) ||
        value.cursor !== undefined && typeof value.cursor !== "string" ||
        value.limit !== undefined && (!Number.isSafeInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 20) ||
        value.expectedRevision !== undefined && (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0)) {
        return invalidAgentToolInput("get_trip_items input is invalid");
      }
      return validAgentToolInput(value as TripReadInput);
    },
    async execute(input): Promise<AgentToolResult<TripReadOutput>> {
      if (input.expectedRevision !== undefined && input.expectedRevision !== trip.revision) return failedAgentToolResult({
        code: "stale_revision", message: "Trip revision changed; reload before continuing", retryable: false,
      });
      if (input.itemIds) {
        const wanted = new Set(input.itemIds), selected = trip.items.filter(item => wanted.has(item.id));
        const missing = input.itemIds.filter(id => !selected.some(item => item.id === id));
        return successfulAgentToolResult({ contractVersion: "trip-read-v1" as const, tripId: trip.id, sourceRevision: trip.revision,
          items: selected.map(selectedTripItemSnapshot), coverage: { status: missing.length ? "partial" : "complete", requestedItemIds: input.itemIds, missingItemIds: missing },
          continuation: null });
      }
      const offset = input.cursor ? parseCursor(input.cursor, trip) : 0;
      if (offset === undefined) return failedAgentToolResult({ code: "stale_revision", message: "Trip cursor is stale or invalid", retryable: false });
      const limit = input.limit ?? 20, selected = trip.items.slice(offset, offset + limit), next = offset + selected.length;
      return successfulAgentToolResult({ contractVersion: "trip-read-v1" as const, tripId: trip.id, sourceRevision: trip.revision,
        items: selected.map(selectedTripItemSnapshot), coverage: { status: next < trip.items.length ? "partial" : "complete", offset, returned: selected.length, total: trip.items.length,
          omittedCount: Math.max(0, trip.items.length - next) }, continuation: next < trip.items.length ? cursor(trip, next) : null });
    },
  });
  evidence.register("get_trip_items", (output, context) => {
    if (!record(output) || !Array.isArray(output.items) || typeof output.tripId !== "string" || !Number.isSafeInteger(output.sourceRevision)) return [];
    const observationScope = stableContractHash({ coverage: output.coverage, itemIds: output.items.flatMap(item =>
      record(item) && typeof item.itemId === "string" ? [item.itemId] : []) }).slice(0, 16);
    return [{ id: `trip-read:${context.executionId}:${output.sourceRevision}:${observationScope}`, category: "external", knowledgeKind: "deterministic_fact",
      subject: `trip:${output.tripId}`, facts: { status: "available", itemIds: output.items.flatMap(item => record(item) && typeof item.itemId === "string" ? [item.itemId] : []) },
      references: [{ sourceType: "trip-state", sourceRef: `${output.tripId}@${output.sourceRevision}`, retrievedAt: context.retrievedAt,
        freshness: "current", summary: `${output.items.length}件のTrip項目をrevision ${output.sourceRevision}から取得` }], coverage: ["trip.itinerary"] }];
  });
}

function cursor(trip: Trip, offset: number): string { return Buffer.from(JSON.stringify({ tripId: trip.id, revision: trip.revision, offset })).toString("base64url"); }
function parseCursor(value: string, trip: Trip): number | undefined {
  try { const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return record(decoded) && decoded.tripId === trip.id && decoded.revision === trip.revision && Number.isSafeInteger(decoded.offset) && Number(decoded.offset) >= 0 ? Number(decoded.offset) : undefined;
  } catch { return undefined; }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
