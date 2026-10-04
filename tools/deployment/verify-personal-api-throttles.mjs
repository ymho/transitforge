import { pathToFileURL } from "node:url";

export function verifyPersonalApiThrottles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid method settings");
  const settings = new Map();
  for (const [key, method] of Object.entries(value)) {
    const normalized = key.replaceAll("~1", "/").replace(/^\//u, "");
    if (settings.has(normalized)) throw new Error("Ambiguous method settings");
    settings.set(normalized, method);
  }
  const matches = (method, rate, burst) => method?.throttlingRateLimit === rate && method?.throttlingBurstLimit === burst &&
    method?.metricsEnabled === true && method?.dataTraceEnabled === false && method?.loggingLevel === "OFF" && method?.cachingEnabled === false;
  if (!matches(settings.get("*/*"), 1, 2) || !matches(settings.get("api/agent-stream/POST") ?? settings.get("*/*"), 1, 2) ||
      !["conversations", "trips"].every(name => matches(settings.get(`api/${name}/v1/POST`), 5, 10)))
    throw new Error("Unexpected API method limits");
  return "API throttles verified: conversation/trip=5/s burst10; Agent/default=1/s burst2.\n";
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 16384) throw new Error("Oversized projection");
    }
    process.stdout.write(verifyPersonalApiThrottles(JSON.parse(input)));
  } catch { process.stderr.write("API throttle verification failed.\n"); process.exitCode = 1; }
}
