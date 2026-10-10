import { expect, it, vi } from "vitest";
import { createTrip, TripRevisionConflict } from "@raiquora/trip/trip";
import type { TripMutationRequest } from "./server-trip-client";
import { regenerateTripTitle } from "./regenerate-trip-title";
const id = "11111111-1111-4111-8111-111111111111";
it("generates from a fresh revision and saves only a title patch", async () => {
  const trip = { ...createTrip(id, "最初の入力", "2026-10-10T00:00:00Z"), revision: 5 };
  const client = { get: vi.fn(async () => trip), generateTitle: vi.fn(async () => "出雲の町歩き"), mutate: vi.fn(async (_mutation: TripMutationRequest) => trip) };
  await regenerateTripTitle(client, id);
  expect(client.generateTitle).toHaveBeenCalledWith(id, 5);
  expect(client.mutate.mock.calls[0]?.[0]).toMatchObject({ tripId: id, baseRevision: 5, proposal: { baseRevision: 5, patches: [{ type: "title", title: "出雲の町歩き" }] } });
});
it("does not save failed generation and never retries a conflict with a fresh revision", async () => {
  const trip = createTrip(id, "元のタイトル", "2026-10-10T00:00:00Z");
  const mutate = vi.fn(async () => { throw new TripRevisionConflict(); });
  const failed = { get: vi.fn(async () => trip), generateTitle: vi.fn(async () => { throw new Error("offline"); }), mutate };
  await expect(regenerateTripTitle(failed, id)).rejects.toThrow("offline"); expect(mutate).not.toHaveBeenCalled();
  await expect(regenerateTripTitle({ ...failed, generateTitle: vi.fn(async () => "出雲の旅") }, id)).rejects.toBeInstanceOf(TripRevisionConflict);
  expect(mutate).toHaveBeenCalledTimes(1);
});
