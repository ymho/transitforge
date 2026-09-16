import { describe, expect, it, vi } from "vitest";
import { createNotificationHandler } from "./notification-handler.js";
import { handler as tick } from "./notification-lambda.js";
import { TripResourceError } from "./contracts/trip-api.js";
import type { LambdaHttpEvent } from "./contracts/http.js";
const event = (extra = {}) => ({ requestContext: { http: { method: "POST", path: "/api/trips/notifications/v1" } }, body: JSON.stringify({ version: "notification-api-v1", operation: "list", ...extra }) }) as LambdaHttpEvent;
describe("notification API trust boundary", () => {
  it("default endpoint remains gated; no identity inferred from headers/body", async () => {
    expect((await createNotificationHandler()(event())).statusCode).toBe(501);
    const app = { list: vi.fn(async () => ({ notifications: [] })), read: vi.fn(async () => {}) };
    const handler = createNotificationHandler(app, async () => ({ subject: "trusted" }));
    expect((await handler(event({ ownerSubject: "forged" }))).statusCode).toBe(400); expect(app.list).not.toHaveBeenCalled();
    expect((await handler(event())).statusCode).toBe(200); expect(app.list).toHaveBeenCalledWith({ subject: "trusted" }, undefined);
  });
  it("read commands are CAS, malformed input rejected and private errors hidden", async () => {
    const app = { list: vi.fn(async () => { throw new Error("private-key"); }), read: vi.fn(async () => {}) };
    const handler = createNotificationHandler(app, async () => ({ subject: "trusted" }));
    expect((await handler(event({ operation: "read", id: "a".repeat(64), revision: 2 }))).statusCode).toBe(200);
    expect(app.read).toHaveBeenCalledWith({ subject: "trusted" }, "a".repeat(64), 2);
    expect((await handler(event({ operation: "read", id: "a".repeat(64), revision: -1 }))).statusCode).toBe(400);
    const failed = await handler(event()); expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain("private-key");
    expect((await handler({ ...event(), body: "{" })).statusCode).toBe(400);
    expect((await createNotificationHandler(app, async () => { throw new TripResourceError("unauthenticated"); })(event())).statusCode).toBe(401);
  });
  it("public body cannot enqueue or invoke worker; ticks require exact internal rule", async () => {
    const h = createNotificationHandler({ list: async () => ({ notifications: [] }), read: async () => {} }, async () => ({ subject: "owner" }));
    for (const operation of ["send", "redrive", "decide", "reconcile"]) expect((await h(event({ operation }))).statusCode).toBe(400);
    await expect(tick({ ownerSubject: "forged", operation: "send" }, { getRemainingTimeInMillis: () => 180000 })).rejects.toThrow("invalid-internal-trigger");
  });
});
