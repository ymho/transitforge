import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import type { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { failedAgentToolResult, invalidAgentToolInput, successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { selectedTripItemSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { stableContractHash } from "@raiquora/agent/output-contract";
import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import type { PlaceSnapshot } from "@raiquora/trip/place-snapshot";

/** A bounded, owner-scoped search hint. Item order is not a verified route or available time window. */
export function registerTripSearchContextTool(tools: AgentToolRegistry, evidence: ToolEvidenceRegistry, trip: Trip): void {
  tools.register({
    name: "get_trip_search_context",
    description: "Trip内の予定IDの直後に観光・食事・イベント等を探す前に、前後の予定と保持済みの場所・日程を確認する。項目順は移動可能性や空き時間を証明しない。候補をTripへ採用しない。",
    effect: "read", prerequisite: ["trusted_trip_scope"], requiredCapabilities: ["trip.read"],
    inputSchema: { type: "object", additionalProperties: false, required: ["anchorItemId"], properties: {
      anchorItemId: { type: "string", minLength: 1, maxLength: 200 }, expectedRevision: { type: "integer", minimum: 0 },
    } },
    parseInput(value) {
      if (!record(value) || Object.keys(value).some(key => !["anchorItemId", "expectedRevision"].includes(key)) ||
          typeof value.anchorItemId !== "string" || !value.anchorItemId.trim() || value.anchorItemId.length > 200 ||
          value.expectedRevision !== undefined && (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0)) {
        return invalidAgentToolInput("get_trip_search_context input is invalid");
      }
      return validAgentToolInput(value as { anchorItemId: string; expectedRevision?: number });
    },
    async execute(input) {
      if (input.expectedRevision !== undefined && input.expectedRevision !== trip.revision) return failedAgentToolResult({
        code: "stale_revision", message: "Trip revision changed; reload before searching", retryable: false,
      });
      const index = trip.items.findIndex(item => item.id === input.anchorItemId);
      if (index < 0) return failedAgentToolResult({ code: "not_found", message: "Anchor item is not in this Trip", retryable: false });
      const anchor = trip.items[index]!;
      const after = trip.items[index + 1];
      return successfulAgentToolResult({ contractVersion: "trip-search-context-v1" as const, tripId: trip.id, sourceRevision: trip.revision,
        placement: "after_anchor_before_next_in_trip_item_order" as const,
        anchor: searchItem(anchor, "departure"), ...(after ? { next: searchItem(after, "arrival") } : {}),
        constraints: { travelTimeVerified: false, freeTimeVerified: false, openingHoursVerified: false,
          ...(after ? {} : { nextItemKnown: false }) },
      });
    },
  });
  evidence.register("get_trip_search_context", (output, context) => {
    if (!record(output) || typeof output.tripId !== "string" || !Number.isSafeInteger(output.sourceRevision) || !record(output.anchor) ||
        typeof output.anchor.itemId !== "string") return [];
    const anchor = output.anchor;
    const next = record(output.next) && typeof output.next.itemId === "string" ? output.next : undefined;
    const anchorItemId = anchor.itemId as string;
    const key = stableContractHash({ anchorItemId, nextItemId: next?.itemId }).slice(0, 16);
    return [{ id: `trip-search-context:${context.executionId}:${output.sourceRevision}:${key}`, category: "external", knowledgeKind: "deterministic_fact",
      subject: `trip:${output.tripId}`, facts: { status: "available", anchorItemId,
        ...(next ? { nextItemId: next.itemId as string } : {}), travelTimeVerified: false, freeTimeVerified: false },
      references: [{ sourceType: "trip-state", sourceRef: `${output.tripId}@${output.sourceRevision}`, retrievedAt: context.retrievedAt,
        freshness: "current", summary: "Tripの項目順における前後の予定。移動時間・空き時間は未検証" }], coverage: ["trip.itinerary"] }];
  });
}

function searchItem(item: ItineraryItem, edge: "departure" | "arrival") {
  const place = item.type === "activity" ? item.place : item.type === "stay"
    ? item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place
    : item.detail.status === "selected" ? item.detail.mode === "rail" ? undefined
      : edge === "departure" ? item.detail.destination : item.detail.origin : undefined;
  return { ...selectedTripItemSnapshot(item), ...(place ? { searchPlace: placeHint(place) } : {}) };
}
function placeHint(place: PlaceSnapshot) {
  return { name: place.name, ...(place.area ? { area: place.area } : {}),
    ...(place.coordinate ? { coordinate: { ...place.coordinate } } : {}),
    provenance: place.sources.length ? "retained-provider-snapshot" as const : "unverified-manual-snapshot" as const };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
