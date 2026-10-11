import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const apiPaths = ["/api/agent-stream", "/api/conversations/v1", "/api/profile/v1", "/api/trips/v1", "/api/trips/sharing/v1"];
const reference = /^[A-Za-z0-9-]{1,128}$/u;

function awsJson(args) {
  // Key values stay in memory; no shell, file, log, retry loop, or raw error output.
  return JSON.parse(execFileSync("aws", [...args, "--output", "json", "--no-cli-pager"], {
    encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env: {...process.env, AWS_MAX_ATTEMPTS: "1", AWS_PAGER: ""},
  }));
}

export function verifyJapanAccessPreparation(config, read = awsJson) {
  if (!config || ![config.rest_api_id, config.stage_name, config.api_key_id].every(v => typeof v === "string" && reference.test(v)) ||
      !Array.isArray(config.distribution_ids) || ![1, 2].includes(config.distribution_ids.length) ||
      new Set(config.distribution_ids).size !== config.distribution_ids.length || !config.distribution_ids.every(v => reference.test(v))) {
    throw new Error("Invalid preparation references");
  }
  const key = read(["apigateway", "get-api-key", "--api-key", config.api_key_id, "--include-value"]);
  if (key.enabled !== true || typeof key.value !== "string" || !key.value) throw new Error("Origin key is not enabled");
  const plans = read(["apigateway", "get-usage-plans", "--key-id", config.api_key_id, "--no-paginate"]);
  if (plans.position || !(plans.items ?? []).some(plan => (plan.apiStages ?? []).some(stage => stage.apiId === config.rest_api_id && stage.stage === config.stage_name))) {
    throw new Error("Origin key is not associated with the API stage");
  }
  for (const id of config.distribution_ids) {
    const distribution = read(["cloudfront", "get-distribution", "--id", id]).Distribution;
    const settings = distribution?.DistributionConfig;
    if (distribution?.Status !== "Deployed" || settings?.Enabled !== true) throw new Error("CloudFront propagation is incomplete");
    const origins = (settings.Origins?.Items ?? []).filter(origin => origin.DomainName?.startsWith(`${config.rest_api_id}.execute-api.`));
    if (origins.length !== 1 || origins[0].OriginPath !== `/${config.stage_name}`) throw new Error("API origin is missing");
    const headers = (origins[0].CustomHeaders?.Items ?? []).filter(header => header.HeaderName?.toLowerCase() === "x-api-key");
    if (headers.length !== 1 || headers[0].HeaderValue !== key.value) throw new Error("CloudFront origin key does not match");
    const behaviors = [settings.DefaultCacheBehavior, ...(settings.CacheBehaviors?.Items ?? [])];
    if (behaviors.some(behavior => (behavior?.FunctionAssociations?.Items ?? []).some(fn => fn.FunctionARN?.endsWith("-japan-only"))) ||
        settings.Restrictions?.GeoRestriction?.RestrictionType !== "none") throw new Error("Country filtering was enabled during preparation");
    for (const pattern of ["/api/agent-stream", "/api/conversations/*", "/api/profile/*", "/api/trips/*"]) {
      if (!(settings.CacheBehaviors?.Items ?? []).some(behavior => behavior.PathPattern === pattern && behavior.TargetOriginId === origins[0].Id)) {
        throw new Error("API behavior does not use the prepared origin");
      }
    }
  }
  const resources = read(["apigateway", "get-resources", "--rest-api-id", config.rest_api_id, "--limit", "500", "--no-paginate"]);
  if (resources.position) throw new Error("API resource readback is incomplete");
  for (const path of apiPaths) {
    const resource = (resources.items ?? []).find(item => item.path === path);
    if (!resource || !reference.test(resource.id)) throw new Error("Expected API resource is missing");
    const method = read(["apigateway", "get-method", "--rest-api-id", config.rest_api_id, "--resource-id", resource.id, "--http-method", "POST"]);
    if (method.apiKeyRequired !== false || method.authorizationType !== "COGNITO_USER_POOLS") throw new Error("API enforcement changed during preparation");
  }
  return `Origin-key preparation verified: ${config.distribution_ids.length} deployed distributions, 5 Cognito-protected API methods; enforcement deferred. Domestic authenticated access remains to be verified.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 16384) throw new Error("Oversized references");
    }
    process.stdout.write(verifyJapanAccessPreparation(JSON.parse(input)));
  } catch {
    process.stderr.write("Origin-key preparation verification failed; key values and raw AWS diagnostics are withheld.\n");
    process.exitCode = 1;
  }
}
