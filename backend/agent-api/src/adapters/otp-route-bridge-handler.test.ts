import { expect, it } from "vitest";
import { createOtpRouteBridgeHandler } from "./otp-route-bridge-handler.js";

it("validates the IAM invocation before searching the graph pinned by the manifest", async () => {
  const coverage = { bounds: { south: 35, west: 132, north: 36, east: 133 }, serviceStart: "2026-10-01", serviceEnd: "2026-10-31",
    feedUrl: "https://example.org/feed.zip", feedRetrievedAt: "2026-09-28T00:00:00Z", graphBuiltAt: "2026-09-28T01:00:00Z", attribution: "source" };
  let searched = false;
  const handler = createOtpRouteBridgeHandler({ load: async () => ({ version: "v", graph: { bucket: "b", key: "k", bytes: 1, sha256: "a".repeat(64) }, otpImage: "i", coverage }) },
    value => ({ search: async request => { searched = true; expect(value).toBe(coverage); expect(request.mode).toBe("walk");
      return { status: "no_route", routes: [], coverage, checkedAt: "2026-09-28T02:00:00Z" }; } }));
  await expect(handler({ origin: { name: "A", latitude: 35.4, longitude: 132.7 }, destination: { name: "B", latitude: 35.5, longitude: 132.8 },
    departureAt: "2026-10-01T09:00:00+09:00", mode: "walk" })).resolves.toMatchObject({ status: "no_route" });
  expect(searched).toBe(true);
  await expect(handler({ mode: "bus" })).rejects.toThrow();
});
