import { describe, expect, it } from "vitest";
import { trustedTick, handler } from "./trip-changed-lambda.js";
const arn = "arn:aws:events:ap-northeast-1:123456789012:rule/trip-changed";
const tick = { source: "aws.events", "detail-type": "Scheduled Event", resources: [arn], detail: {} };
describe("internal TripChanged entrypoint", () => {
  it("only recognizes the configured wake-up rule, no caller-selected owner/task", () => {
    expect(trustedTick(tick, arn)).toBe(true);
    for (const event of [{ ...tick, ownerSubject: "victim" }, { ...tick, detail: { ownerSubject: "victim" } },
      { ...tick, resources: ["forged"] }, { body: JSON.stringify(tick) }, { source: "http" }, null]) expect(trustedTick(event, arn)).toBe(false);
    expect(trustedTick(tick, "")).toBe(false);
  });
  it("rejects forged routing before constructing repositories", async () => {
    await expect(handler({ ownerSubject: "victim" }, { getRemainingTimeInMillis: () => 90_000 })).rejects.toThrow("invalid-internal-trigger");
  });
});
