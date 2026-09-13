import { it, expect, vi } from "vitest";
import { createTripWorkspaceController } from "./trip-workspace-controller";
import { createServerTripWorkspaceSource } from "./server-trip-workspace-source";
import { tripWorkspacePreviewSource } from "../../dev/trip-workspace-preview";
import { feasibilityTrip } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { checklistItem } from "../../../../modules/trip/domain/trip-checklist.fixture";

it("previews without writing Trip, confirms explicitly, rejects duplicates, and keeps session proposals separate", async () => {
  const source = tripWorkspacePreviewSource(), trip = structuredClone(source.getCurrentTrip()!);
  const c = createTripWorkspaceController("a"); c.attach("a", source);
  const proposal = { tripId: trip.id, suggestions: [{ category: "packing" as const, title: "傘" }] };
  c.checklist.preview(proposal); expect(c.checklist.items()).toHaveLength(1);
  c.activateSession("b"); expect(c.checklist.proposal()).toBeUndefined(); expect(c.checklist.canWrite()).toBe(false);
  c.activateSession("a"); await c.checklist.confirm();
  expect(c.checklist.items()).toHaveLength(2); expect(c.current()).toEqual(trip);
  c.checklist.preview(proposal); expect(c.checklist.proposal()).toBeUndefined(); await expect(c.checklist.confirm()).rejects.toThrow();
});
it("keeps public writer off; reader errors are unavailable, wrong-scope data is rejected and failed write re-reads", async () => {
  const trip = feasibilityTrip(), items = [checklistItem()], reader = { list: vi.fn(async () => items) };
  const source = createServerTripWorkspaceSource(trip.id, { get: async () => trip }, undefined, undefined, undefined, { reader });
  await source.refresh(); expect(source.checklist?.getItems()).toEqual(items); expect(source.checklist?.write).toBeUndefined();
  reader.list.mockRejectedValueOnce(new Error("offline")); await source.refresh(); expect(source.checklist?.getItems()).toBeUndefined();
  reader.list.mockResolvedValueOnce([checklistItem({ tripId: checklistItem().id })]); await source.refresh(); expect(source.checklist?.getItems()).toBeUndefined();
  const execute = vi.fn(async () => { throw new Error("conflict"); });
  const writable = createServerTripWorkspaceSource(trip.id, { get: async () => trip }, undefined, undefined, undefined, { reader, writer: { execute } });
  await writable.refresh(); const calls = reader.list.mock.calls.length;
  await expect(writable.checklist!.write!({ operation: "update", tripId: trip.id, id: items[0]!.id, baseRevision: 0, changes: { status: "done" } })).rejects.toThrow();
  expect(reader.list.mock.calls.length).toBeGreaterThan(calls); expect(writable.checklist?.getItems()).toEqual(items); expect(execute).toHaveBeenCalledTimes(1);
});
