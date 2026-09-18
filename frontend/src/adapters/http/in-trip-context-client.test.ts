import { expect, it, vi } from "vitest";
import { HttpInTripContextClient } from "./in-trip-context-client";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
it("reads only a Trip reference, rejects private extras and gate failures", async () => {
  const f = inTripFixture(), fetcher = vi.fn(async () => new Response(JSON.stringify({ version: "in-trip-api-v1", snapshot: f.snapshot })));
  const client = new HttpInTripContextClient(fetcher as typeof fetch);
  expect(await client.read(f.trip.id)).toEqual(f.snapshot);
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ version: "in-trip-api-v1", tripId: f.trip.id });
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ version: "in-trip-api-v1", snapshot: { ...f.snapshot, raw: "secret" } })));
  await expect(client.read(f.trip.id)).rejects.toThrow();
  fetcher.mockImplementation(async () => new Response("{}", { status: 501 })); await expect(client.read(f.trip.id)).rejects.toThrow();
});
