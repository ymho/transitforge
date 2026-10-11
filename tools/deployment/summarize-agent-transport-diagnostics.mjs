import { readFile } from "node:fs/promises";
/** Never publish raw gateway/runtime errors, headers, identities or payloads. */
export function summarizeTransport(gateway, reports) {
  const numeric = value => /^\d+(?:\.\d+)?$/u.test(String(value)) ? Number(value) : undefined;
  const rows = [];
  for (const entry of gateway) {
    let value; try { value = JSON.parse(entry.message); } catch { continue; }
    const status = numeric(value.status);
    if (!status || status < 500 || status > 599) continue;
    const responseType = ["INTEGRATION_FAILURE", "INTEGRATION_TIMEOUT", "AUTHORIZER_FAILURE", "AUTHORIZER_CONFIGURATION_ERROR", "DEFAULT_5XX"].includes(value.responseType) ? value.responseType : "unknown";
    rows.push(`| ${new Date(entry.timestamp).toISOString()} | ${status} | ${numeric(value.integrationStatus) ?? "—"} | ${numeric(value.integrationLatencyMs) ?? "—"} | ${responseType} |`);
  }
  const completed = reports.flatMap(entry => {
    const match = String(entry.message).match(/REPORT RequestId: [0-9a-f-]+\s+Duration: ([0-9.]+) ms/u);
    if (!match) return [];
    const status = String(entry.message).match(/Status: (timeout|error|success)\b/u)?.[1] ?? "unknown";
    return [{ duration: Number(match[1]), status, timestamp: Number.isFinite(entry.timestamp) ? new Date(entry.timestamp).toISOString() : "—" }];
  });
  return ["### Agent transport failures", "", "| UTC | HTTP | Integration | Latency ms | Response type |", "|---|---:|---:|---:|---|", ...rows.slice(-20), "",
    `Lambda reports: ${completed.length}; maximum invocation duration ms: ${completed.length ? Math.max(...completed.map(item => item.duration)) : "—"}`,
    "", "| Lambda completed UTC | Duration ms | Status |", "|---|---:|---|", ...completed.slice(-20).map(item => `| ${item.timestamp} | ${item.duration} | ${item.status} |`)].join("\n");
}
if (process.argv[1]?.endsWith("summarize-agent-transport-diagnostics.mjs")) {
  const [gateway, reports] = await Promise.all(process.argv.slice(2, 4).map(async file => JSON.parse(await readFile(file, "utf8"))));
  console.log(summarizeTransport(gateway, reports));
}
