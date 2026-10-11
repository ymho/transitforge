import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTransport } from "./summarize-agent-transport-diagnostics.mjs";
test("publishes bounded transport metadata and duration without raw errors or identities", () => {
 const output = summarizeTransport([{ timestamp: 1, message: JSON.stringify({ status: "500", integrationStatus: "429", integrationLatencyMs: "1", responseType: "INTEGRATION_FAILURE", error: "PRIVATE", requestId: "PRIVATE" }) }, { timestamp: 2, message: JSON.stringify({ status: "200" }) }], [{ message: "REPORT RequestId: 1234-abcd Duration: 240000.00 ms Billed Duration: 240000 ms Memory Size: 1024 MB" }]);
 assert.match(output, /500.*429.*INTEGRATION_FAILURE/); assert.match(output, /240000/); assert.doesNotMatch(output, /PRIVATE|Billed|Memory/);
});
