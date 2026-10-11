import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTransport } from "./summarize-agent-transport-diagnostics.mjs";
test("publishes bounded transport metadata and duration without raw errors or identities", () => {
 const output = summarizeTransport([{ timestamp: 1, message: JSON.stringify({ status: "500", integrationStatus: "429", integrationLatencyMs: "1", responseType: "INTEGRATION_FAILURE", error: "PRIVATE", requestId: "PRIVATE" }) }, { timestamp: 2, message: JSON.stringify({ status: "200" }) }], [{ message: "REPORT RequestId: 1234-abcd Duration: 240000.00 ms Billed Duration: 240000 ms Memory Size: 1024 MB" }]);
 assert.match(output, /500.*429.*INTEGRATION_FAILURE/); assert.match(output, /240000/); assert.doesNotMatch(output, /PRIVATE|Billed|Memory/);
});
test("distinguishes invocation throttling and initialization errors without exposing messages", () => {
 const output = summarizeTransport([], [], [{timestamp: 1, message: "INIT_REPORT Init Duration: 12.5 ms Phase: invoke Status: error Error Type: Runtime.ImportModuleError PRIVATE"}, {timestamp: 2, message: "ERROR Runtime.ExitError PRIVATE"}], {
  Throttles: {Datapoints: [{Timestamp: "2026-10-11T10:12:00Z", Sum: 3}, {Timestamp: "2026-10-11T10:11:00Z", Sum: 0}]},
  ConcurrentExecutions: {Datapoints: [{Timestamp: "2026-10-11T10:12:00Z", Maximum: 1}]},
  PRIVATE: {Datapoints: [{Timestamp: "2026-10-11T10:12:00Z", Sum: 999}]}
 });
 assert.match(output, /invoke.*error/); assert.match(output, /Runtime.ImportModuleError: 1/); assert.match(output, /Runtime.ExitError: 1/);
 assert.match(output, /10:12:00.000Z.*Throttles.*3/); assert.match(output, /ConcurrentExecutions.*1/);
 assert.doesNotMatch(output, /PRIVATE|999|10:11:00/);
});
