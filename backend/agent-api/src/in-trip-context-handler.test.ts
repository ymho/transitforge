import { expect, it, vi } from "vitest";
import { createInTripContextHandler } from "./in-trip-context-handler.js";
import type { LambdaHttpEvent } from "./contracts/http.js";
import { inTripFixture } from "../../../modules/trip/domain/in-trip-context.fixture.js";
const f = inTripFixture();
const event = (extra = {}): LambdaHttpEvent => ({ requestContext: { http: { method: "POST" } },
  body: JSON.stringify({ version: "in-trip-api-v1", tripId: f.trip.id, ...extra }) });
it("closed public gate, trusted owner only and no location/body injection", async () => {
  expect((await createInTripContextHandler()(event())).statusCode).toBe(501);
  const app = { read: vi.fn(async () => f.snapshot) }, h = createInTripContextHandler(app, async () => ({ subject: "trusted" }));
  for (const v of [{ ownerSubject: "forged" }, { location: { latitude: 1 } }, { operation: "update" }]) expect((await h(event(v))).statusCode).toBe(400);
  expect(app.read).not.toHaveBeenCalled(); expect((await h(event())).statusCode).toBe(200);
  expect(app.read).toHaveBeenCalledWith({ subject: "trusted" }, f.trip.id);
  app.read.mockRejectedValue(new Error("private")); const r = await h(event()); expect(r.statusCode).toBe(503); expect(r.body).not.toContain("private");
});
