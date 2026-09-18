import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, migrate, readSecret, secretNames, split } from "./secrets.mjs";

const source = { application_id: "synthetic-app", access_key: "synthetic-key", hotel_search_url: "https://provider.invalid/search",
  vacant_hotel_search_url: "https://provider.invalid/vacancy", affiliate_id: "synthetic-affiliate",
  brave_search_api_key: "synthetic-brave", mapbox_search_access_token: "synthetic-mapbox", hot_pepper_api_key: "synthetic-food", ignored: "not copied" };
function fixture(initial = {}) {
  const values = new Map([[secretNames.source, source], ...Object.entries(initial)]), calls = [];
  return { values, calls, call: async (service, operation, input) => {
    calls.push({ service, operation, input });
    if (operation === "describe-secret") return { Name: input.SecretId, VersionIdsToStages: values.has(input.SecretId) ? { synthetic: ["AWSCURRENT"] } : {} };
    if (operation === "get-secret-value") return { SecretString: JSON.stringify(values.get(input.SecretId)) };
    if (operation === "put-secret-value") { values.set(input.SecretId, JSON.parse(input.SecretString)); return {}; }
    throw new Error("unexpected operation");
  } };
}
test("split copies only allowlisted fields, preserving the source", () => {
  const copy = structuredClone(source), result = split(source);
  assert.deepEqual(Object.keys(result.travel).sort(), ["access_key", "affiliate_id", "application_id", "hotel_search_url", "vacant_hotel_search_url"]);
  assert.deepEqual(Object.keys(result.agent).sort(), ["brave_search_api_key", "hot_pepper_api_key", "mapbox_search_access_token"]);
  assert.deepEqual(source, copy);
  assert.deepEqual(split({ application_id: "x", access_key: "x", hotel_search_url: "https://p.invalid" }).agent, {});
});
test("invalid, empty, mixed and unsafe contracts fail without reflecting values", () => {
  for (const value of [null, [], { ...split(source).travel, extra: "PRIVATE" }, { ...split(source).travel, access_key: " " },
    { ...split(source).travel, hotel_search_url: "http://PRIVATE.invalid" }, { ...split(source).travel, vacant_hotel_search_url: "https://user:PRIVATE@p.invalid" }]) {
    assert.throws(() => contract(value, "travel"), error => !String(error).includes("PRIVATE"));
  }
  for (const value of [{ application_id: "PRIVATE" }, { brave_search_api_key: 7 }, { brave_search_api_key: "" }]) assert.throws(() => contract(value, "agent"));
});
test("migration initializes two empty containers once and then performs no writes", async () => {
  const f = fixture(); await migrate(f.call); await migrate(f.call);
  const puts = f.calls.filter(call => call.operation === "put-secret-value");
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map(call => call.input.SecretId), [secretNames.travel, secretNames.agent]);
  assert.deepEqual(f.values.get(secretNames.source), source);
});
test("both destinations are preflighted before any write; conflicting values never overwrite", async () => {
  const f = fixture({ [secretNames.agent]: { brave_search_api_key: "other synthetic value" } });
  await assert.rejects(migrate(f.call), /validation failed/u);
  assert.equal(f.calls.filter(call => call.operation === "put-secret-value").length, 0);
});
test("missing container, access denial, malformed JSON and staged-only versions are not empty", async () => {
  for (const call of [
    async () => { throw new Error("AWS operation failed"); },
    async (_service, operation) => operation === "describe-secret" ? { Name: secretNames.travel, VersionIdsToStages: { x: ["AWSPENDING"] } } : {},
    async (_service, operation) => operation === "describe-secret" ? { Name: secretNames.travel, VersionIdsToStages: { x: ["AWSCURRENT"] } } : { SecretString: "PRIVATE not JSON" },
  ]) await assert.rejects(readSecret(call, secretNames.travel));
});
test("partial migration failure can be resumed without rewriting the first secret", async () => {
  const f = fixture();
  await assert.rejects(migrate(async (...args) => {
    if (args[1] === "put-secret-value" && args[2].SecretId === secretNames.agent) throw new Error("failure");
    return f.call(...args);
  }));
  await migrate(f.call);
  assert.equal(f.calls.filter(call => call.operation === "put-secret-value").length, 2);
});
