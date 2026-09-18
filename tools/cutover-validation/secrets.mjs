import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { requireCheck } from "./safety.mjs";

export const secretNames = Object.freeze({
  source: "/transitforge/dev/travel-provider",
  travel: "/transitforge/dev/fixed-egress-travel-provider",
  agent: "transitforge-dev-agent-stream-providers",
});
const travelKeys = ["application_id", "access_key", "hotel_search_url", "vacant_hotel_search_url", "affiliate_id"];
const agentKeys = ["mapbox_search_access_token", "brave_search_api_key", "hot_pepper_api_key"];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function contract(value, kind) {
  requireCheck(object(value));
  const allowed = kind === "travel" ? travelKeys : agentKeys;
  requireCheck(Object.keys(value).every(key => allowed.includes(key)));
  for (const entry of Object.values(value)) requireCheck(typeof entry === "string" && entry.trim().length > 0);
  if (kind === "travel") {
    for (const key of travelKeys.slice(0, 3)) requireCheck(Object.hasOwn(value, key));
    for (const key of ["hotel_search_url", "vacant_hotel_search_url"]) if (Object.hasOwn(value, key)) {
      let url; try { url = new URL(value[key]); } catch { throw new Error("secret contract failed"); }
      requireCheck(url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname));
    }
  }
  return value;
}
export function split(source) {
  requireCheck(object(source));
  const pick = keys => Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
  return { travel: contract(pick(travelKeys), "travel"), agent: contract(pick(agentKeys), "agent") };
}
export async function readSecret(call, name) {
  // Describe must succeed. Only a genuinely empty, existing container may be initialized.
  const description = await call("secretsmanager", "describe-secret", { SecretId: name });
  requireCheck(!description.DeletedDate && description.Name === name);
  const versions = description.VersionIdsToStages ?? {};
  if (Object.keys(versions).length === 0) return undefined;
  requireCheck(Object.values(versions).some(stages => stages.includes("AWSCURRENT")));
  const result = await call("secretsmanager", "get-secret-value", { SecretId: name, VersionStage: "AWSCURRENT" });
  requireCheck(typeof result.SecretString === "string");
  try { return JSON.parse(result.SecretString); } catch { throw new Error("secret contract failed"); }
}
export async function migrate(call) {
  const desired = split(await readSecret(call, secretNames.source));
  // Preflight both before either write; a mismatch is never an overwrite request.
  const pending = [];
  for (const kind of ["travel", "agent"]) {
    const existing = await readSecret(call, secretNames[kind]);
    if (existing !== undefined) requireCheck(isDeepStrictEqual(contract(existing, kind), desired[kind]));
    else pending.push(kind);
  }
  for (const kind of pending) {
    // Recheck immediately before mutation. External writers must also be quiescent;
    // Secrets Manager has no conditional PutSecretValue/CAS API.
    const latest = await readSecret(call, secretNames[kind]);
    if (latest !== undefined) { requireCheck(isDeepStrictEqual(contract(latest, kind), desired[kind])); continue; }
    await call("secretsmanager", "put-secret-value", { SecretId: secretNames[kind],
      ClientRequestToken: randomUUID(), SecretString: JSON.stringify(desired[kind]) });
    requireCheck(isDeepStrictEqual(await readSecret(call, secretNames[kind]), desired[kind]));
  }
}
