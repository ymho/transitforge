import { describe, expect, it, vi } from "vitest";
import { HttpNotificationClient } from "./notification-client";
describe("Notification HTTP allowlist", () => {
  it("sends only commands with same-origin credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: "notification-api-v1", notifications: [] })));
    expect(await new HttpNotificationClient(undefined, fetcher).list()).toEqual({ notifications: [] });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", body: '{"version":"notification-api-v1","operation":"list"}' });
  });
  it("rejects private extras, unknown resources, and disabled auth gates", async () => {
    for (const value of [{ version: "notification-api-v1", notifications: [], private: "secret" }, { version: "v0", notifications: [] }]) {
      await expect(new HttpNotificationClient(undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value)))).list()).rejects.toThrow();
    }
    await expect(new HttpNotificationClient(undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response("private", { status: 501 }))).list()).rejects.toThrow("認証");
  });
});
