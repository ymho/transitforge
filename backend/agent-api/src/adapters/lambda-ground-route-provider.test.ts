import { expect, it } from "vitest";
import { LambdaGroundRouteProvider } from "./lambda-ground-route-provider.js";

const coverage = { bounds: { south: 35, west: 132, north: 36, east: 133 }, serviceStart: "2026-10-01", serviceEnd: "2026-10-31",
  feedUrl: "https://example.org/feed.zip", feedRetrievedAt: "2026-09-28T00:00:00Z", graphBuiltAt: "2026-09-28T01:00:00Z", attribution: "source" };
const manifests = { load: async () => ({ version: "v", graph: { bucket: "b", key: "k", bytes: 1, sha256: "a".repeat(64) }, otpImage: "i", coverage }) };
const request = { origin: { name: "駅", latitude: 35.4, longitude: 132.7 }, destination: { name: "神社", latitude: 35.5, longitude: 132.8 },
  departureAt: "2026-10-01T09:00:00+09:00", mode: "bus" as const };

it("invokes the private bridge and validates its result against the pinned manifest", async () => {
  const output = { status: "no_route", routes: [], coverage, checkedAt: "2026-09-28T02:00:00Z" };
  const provider = new LambdaGroundRouteProvider("arn", manifests, { invoke: async input => {
    expect(JSON.parse(new TextDecoder().decode(input.Payload))).toEqual(request);
    return { StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify(output)) };
  } });
  await expect(provider.search(request)).resolves.toEqual(output);
});

it("returns a bounded unavailable result when the bridge fails or lies about coverage", async () => {
  const failed = new LambdaGroundRouteProvider("arn", manifests, { invoke: async () => { throw new Error("internal"); } });
  await expect(failed.search(request)).resolves.toMatchObject({ status: "unavailable", coverage });
  const mismatch = new LambdaGroundRouteProvider("arn", manifests, { invoke: async () => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify({ status: "no_route", routes: [], checkedAt: "2026-09-28T02:00:00Z",
      coverage: { ...coverage, serviceEnd: "2099-01-01" } })) }) });
  await expect(mismatch.search(request)).resolves.toMatchObject({ status: "unavailable", coverage });
});

it("rejects a bridge itinerary whose legs do not satisfy the requested mode", async () => {
  const output = { status: "available", coverage, checkedAt: "2026-09-28T02:00:00Z", routes: [{
    departureAt: "2026-10-01T09:00:00+09:00", arrivalAt: "2026-10-01T09:10:00+09:00", durationMinutes: 10,
    legs: [{ mode: "bus", from: "駅", to: "神社", departureAt: "2026-10-01T09:00:00+09:00",
      arrivalAt: "2026-10-01T09:10:00+09:00", distanceMeters: 2_000, routeName: "1",
      geometry: [[132.7, 35.4], [132.8, 35.5]] }],
  }] };
  const invoker = { invoke: async () => ({ StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify(output)) }) };
  await expect(new LambdaGroundRouteProvider("arn", manifests, invoker).search(request)).resolves.toMatchObject({ status: "available" });
  await expect(new LambdaGroundRouteProvider("arn", manifests, invoker).search({ ...request, mode: "walk" })).resolves.toMatchObject({ status: "unavailable" });
});
