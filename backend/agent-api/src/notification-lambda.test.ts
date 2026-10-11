import { afterEach, describe, expect, it, vi } from "vitest";
import { handler } from "./notification-lambda.js";

const { poll } = vi.hoisted(() => ({ poll: vi.fn(async () => undefined) }));
vi.mock("./usecases/notification-application.js", () => ({ NotificationWorker: class { poll = poll; } }));
const rule = "arn:aws:events:ap-northeast-1:123456789012:rule/notification";
const tick = { source: "aws.events", "detail-type": "Scheduled Event", resources: [rule], detail: {} };
const context = { getRemainingTimeInMillis: () => 180_000 };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("suspended notification delivery", () => {
  it.each([undefined, "false"])("does not poll or access storage when activation is %s", async enabled => {
    vi.stubEnv("NOTIFICATION_RULE_ARN", rule);
    vi.stubEnv("NOTIFICATION_ENABLED", enabled);
    vi.stubEnv("NOTIFICATION_TABLE_NAME", undefined);
    vi.stubEnv("TRIP_TABLE_NAME", undefined);
    await expect(handler(tick, context)).resolves.toBeUndefined();
    expect(poll).not.toHaveBeenCalled();
  });
  it("rejects untrusted triggers even while suspended", async () => {
    vi.stubEnv("NOTIFICATION_RULE_ARN", rule);
    vi.stubEnv("NOTIFICATION_ENABLED", "false");
    await expect(handler({ ...tick, detail: { tripId: "forged" } }, context)).rejects.toThrow("invalid-internal-trigger");
    expect(poll).not.toHaveBeenCalled();
  });
});
