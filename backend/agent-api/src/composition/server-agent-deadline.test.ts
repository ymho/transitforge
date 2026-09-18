import { expect, it } from "vitest";
import { serverAgentDeadline } from "./server-agent-deadline.js";

it.each(["1000", "15000", "120000", "180000"])("accepts explicit bounded budget %s", value => {
  expect(serverAgentDeadline({ SERVER_AGENT_MAX_EXECUTION_MS: value })).toBe(Number(value));
});
it.each([undefined, "", "0", "999", "180001", "240000", "-1", "Infinity", "NaN", "120000.5", "1e5", " 120000", "120000ms"])("fails closed for invalid or missing budget %s", value => {
  expect(() => serverAgentDeadline({ SERVER_AGENT_MAX_EXECUTION_MS: value })).toThrow("Invalid Server Agent deadline configuration");
});
