import { describe, expect, it, vi } from "vitest";
import { CollectorRecheckSource } from "./collector-recheck-source.js";

const now = Date.parse("2026-09-13T01:00:00Z"), subject = { type: "rail-service" as const, serviceDate: "2026-09-13", serviceUid: "s1", trainNumber: "1M" };
function setup() {
  const raw = { collectedAt: new Date(now).toISOString(), failedSources: [] as string[], trains: { "1M": { delayMinutes: 10, destination: "B", sources: ["shared-collector"] } } };
  const loadIndex = vi.fn(async () => ({ schema_version: "direct-service-index-v1", service_date: "2026-09-13", services: { s1: { service_uid: "s1", train_no: "1M" } } }));
  const loadRealtimeSnapshot = vi.fn(async () => raw);
  return { raw, loadIndex, loadRealtimeSnapshot, source: new CollectorRecheckSource({ loadIndex, loadRealtimeSnapshot }) };
}
describe("shared collector observation reingest", () => {
  it("uses cached common snapshot and dated input across Trips, no operator API", async () => {
    const f = setup(); const event = await f.source.event(subject, now);
    expect(event.fact).toMatchObject({ status: "observed", delayMinutes: 10 });
    await f.source.event(subject, now); expect(f.loadRealtimeSnapshot).toHaveBeenCalledTimes(1); expect(f.loadIndex).toHaveBeenCalledTimes(1);
  });
  it.each(["stale", "failed", "missing", "ambiguous"])("%s is not on-time", async (kind) => {
    const f = setup();
    if (kind === "stale") f.raw.collectedAt = new Date(now - 600_000).toISOString();
    if (kind === "failed") f.raw.failedSources = ["collector-failed"];
    if (kind === "missing") f.raw.trains = {} as never;
    if (kind === "ambiguous") f.loadIndex.mockResolvedValue({ schema_version: "direct-service-index-v1", service_date: "2026-09-13", services: { s1: { service_uid: "s1", train_no: "1M" }, s2: { service_uid: "s2", train_no: "1M" } } } as never);
    const event = await f.source.event(subject, now);
    expect(event.freshness).not.toBe("fresh"); expect(event.fact).not.toMatchObject({ delayMinutes: 0 });
  });
  it("invalid/unknown delay is rejected, not coerced to zero", async () => {
    const f = setup(); f.raw.trains["1M"].delayMinutes = NaN;
    await expect(f.source.event(subject, now)).rejects.toMatchObject({ code: "invalid_response" });
  });
});
