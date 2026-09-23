import { expect, it } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { registerTripReadTools } from "./trip-read-tool.js";

const tripId = "00000000-0000-4000-8000-000000000201", at = "2026-09-23T00:00:00.000Z";
const items: ItineraryItem[] = Array.from({ length: 25 }, (_, index) => ({ id: `item-${index}`, title: `予定${index}`,
  type: "activity", category: "free-time", schedule: { type: "unscheduled" } }));

it("reads every page with revision-bound coverage and rejects a cursor after revision changes", async () => {
  const trip = createTrip(tripId, "長期旅行", at, items), tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerTripReadTools(tools, evidence, trip);
  const first = await tools.execute("get_trip_items", { limit: 20 }, { executionId: "turn" });
  expect(first).toMatchObject({ ok: true, output: { sourceRevision: 0, items: expect.arrayContaining([expect.objectContaining({ itemId: "item-19" })]),
    coverage: { status: "partial", omittedCount: 5 } } });
  if (!first.ok || !record(first.output) || typeof first.output.continuation !== "string") throw new Error("missing continuation");
  const second = await tools.execute("get_trip_items", { cursor: first.output.continuation }, { executionId: "turn" });
  expect(second).toMatchObject({ ok: true, output: { items: expect.arrayContaining([expect.objectContaining({ itemId: "item-20" })]), coverage: { status: "complete", omittedCount: 0 } } });
  if (!second.ok) throw new Error("second page failed");
  const retrievedAt = "2026-09-23T00:00:00.000Z";
  const firstEvidence = evidence.collect("get_trip_items", first.output, { executionId: "turn", toolCallId: "page-1",
    toolName: "get_trip_items", queryFingerprint: "first-page", retrievedAt });
  const secondEvidence = evidence.collect("get_trip_items", second.output, { executionId: "turn", toolCallId: "page-2",
    toolName: "get_trip_items", queryFingerprint: "second-page", retrievedAt });
  expect(firstEvidence[0]?.id).not.toBe(secondEvidence[0]?.id);

  const changed = { ...trip, revision: 1 }, changedTools = new AgentToolRegistry();
  registerTripReadTools(changedTools, new ToolEvidenceRegistry(), changed);
  expect(await changedTools.execute("get_trip_items", { cursor: first.output.continuation }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "stale_revision" } });
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
