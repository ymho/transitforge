import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { verifyJapanAccessPreparation } from "./verify-japan-access-preparation.mjs";

const paths = ["/api/agent-stream", "/api/conversations/v1", "/api/profile/v1", "/api/trips/v1", "/api/trips/sharing/v1"];
const config = {rest_api_id: "api123", stage_name: "dev", api_key_id: "key123", distribution_ids: ["DIST1", "DIST2"]};
function fixture() {
  const replies = {
    "get-api-key": {enabled: true, value: "secret-origin-key"},
    "get-usage-plans": {items: [{apiStages: [{apiId: "api123", stage: "dev"}]}]},
    "get-distribution": {Distribution: {Status: "Deployed", DistributionConfig: {
      Enabled: true,
      Origins: {Items: [{Id: "api", DomainName: "api123.execute-api.ap-northeast-1.amazonaws.com", OriginPath: "/dev", CustomHeaders: {Items: [{HeaderName: "x-api-key", HeaderValue: "secret-origin-key"}]}}]},
      CacheBehaviors: {Items: ["/api/agent-stream", "/api/conversations/*", "/api/profile/*", "/api/trips/*"].map(PathPattern => ({PathPattern, TargetOriginId: "api"}))},
      Restrictions: {GeoRestriction: {RestrictionType: "none"}},
    }}},
    "get-resources": {items: paths.map((path, index) => ({path, id: `r${index}`}))},
    "get-method": {apiKeyRequired: false, authorizationType: "COGNITO_USER_POOLS"},
  };
  const calls = [];
  return {replies, calls, read: args => {calls.push(args); return replies[args[1]];}};
}
test("readback is bounded and publishes no key values", () => {
  const {calls, read} = fixture();
  const result = verifyJapanAccessPreparation(config, read);
  assert.match(result, /2 deployed distributions, 5 Cognito/u);
  assert.doesNotMatch(result, /secret-origin-key/u);
  assert.equal(calls.length, 10);
  assert.equal(calls.filter(args => args[1] === "get-method").length, 5);
});
test("invalid references fail before AWS access", () => {
  for (const value of [{...config, distribution_ids: []}, {...config, distribution_ids: ["DIST1", "DIST1"]}, {...config, rest_api_id: "--debug" + "\n"}]) {
    const {calls, read} = fixture();
    assert.throws(() => verifyJapanAccessPreparation(value, read));
    assert.equal(calls.length, 0);
  }
});
test("incomplete propagation, wrong key/stage, missing methods and premature enforcement stop preparation", () => {
  const corruptions = [
    replies => {replies["get-distribution"].Distribution.Status = "InProgress";},
    replies => {replies["get-distribution"].Distribution.DistributionConfig.Origins.Items[0].CustomHeaders.Items[0].HeaderValue = "wrong";},
    replies => {replies["get-usage-plans"].items[0].apiStages[0].stage = "wrong";},
    replies => {replies["get-resources"].items.pop();},
    replies => {replies["get-method"].apiKeyRequired = true;},
    replies => {replies["get-method"].authorizationType = "NONE";},
    replies => {replies["get-distribution"].Distribution.DistributionConfig.Restrictions.GeoRestriction.RestrictionType = "whitelist";},
    replies => {replies["get-distribution"].Distribution.DistributionConfig.CacheBehaviors.Items[0].FunctionAssociations = {Items: [{FunctionARN: "arn:cloudfront:function/dev-japan-only"}]};},
  ];
  for (const corrupt of corruptions) {
    const {replies, calls, read} = fixture();
    corrupt(replies);
    assert.throws(() => verifyJapanAccessPreparation(config, read));
    assert.ok(calls.length <= 10);
  }
});
test("temporary probe reports only an unambiguous trusted country on its HEAD route", () => {
  const source = readFileSync(new URL("../../infra/terraform/environments/dev/cloudfront-japan-access-probe.js", import.meta.url), "utf8");
  const invoke = request => vm.runInNewContext(`${source}\n handler(event)`, {event: {request}});
  const request = {method: "HEAD", uri: "/__japan-access-check", headers: {"cf-ipcountry": {value: "JP"}}};
  assert.equal(invoke(request).headers["x-kaiho-visitor-country"].value, "JP");
  assert.equal(invoke(request).headers["cache-control"].value, "private, no-store");
  assert.equal(invoke({...request, headers: {}}).headers["x-kaiho-visitor-country"].value, "unknown");
  assert.equal(invoke({...request, headers: {"cf-ipcountry": {value: "JP", multiValue: [{value: "JP"}, {value: "US"}]}}}).headers["x-kaiho-visitor-country"].value, "unknown");
  for (const actual of [{...request, method: "GET"}, {...request, uri: "/api/trips/v1", method: "POST"}]) assert.equal(invoke(actual), actual);
});
