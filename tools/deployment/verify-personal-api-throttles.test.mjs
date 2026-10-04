import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPersonalApiThrottles } from "./verify-personal-api-throttles.mjs";
const method = (rate = 5, burst = 10) => ({ throttlingRateLimit: rate, throttlingBurstLimit: burst,
  metricsEnabled: true, dataTraceEnabled: false, loggingLevel: "OFF", cachingEnabled: false });
const stage = () => ({ "*/*": method(1, 2), "/api/conversations/v1/POST": method(), "/api/trips/v1/POST": method() });
test("checks real Gateway method overrides while preserving the paid Agent limit", () => {
  assert.match(verifyPersonalApiThrottles(stage()), /Agent\/default=1\/s burst2/u);
  const encoded = { "*/*": method(1, 2), "~1api~1conversations~1v1/POST": method(), "api/trips/v1/POST": method() };
  assert.match(verifyPersonalApiThrottles(encoded), /conversation\/trip=5\/s burst10/u);
  for (const value of [null, {}, { ...stage(), "*/*": method() }, { ...stage(), "/api/agent-stream/POST": method() },
    { ...stage(), "/api/conversations/v1/POST": method(1, 2) },
    { ...stage(), "/api/trips/v1/POST": { ...method(), dataTraceEnabled: true } },
    { ...stage(), "api/conversations/v1/POST": method() }]) assert.throws(() => verifyPersonalApiThrottles(value));
});
