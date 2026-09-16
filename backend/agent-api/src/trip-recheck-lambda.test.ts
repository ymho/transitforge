import { describe, expect, it } from "vitest";
import { handler } from "./trip-recheck-lambda.js";
describe("private recheck entrypoint", () => {
  it.each([{ ownerSubject: "victim" }, { body: "{}" }, { detail: { tripId: "forged" }, source: "aws.events" }, null])("rejects public/forged payload before IO", async (event) => {
    await expect(handler(event, { getRemainingTimeInMillis: () => 180_000 })).rejects.toThrow("invalid-internal-trigger");
  });
});
