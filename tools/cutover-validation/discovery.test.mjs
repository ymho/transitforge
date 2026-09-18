import { test } from "node:test";
import assert from "node:assert/strict";
import { discover } from "./discovery.mjs";

function fixture(change = () => {}) {
  const account = "123456789012", api = "synthetic", pool = "ap-northeast-1_synthetic";
  const name = "transitforge-dev-agent-stream", providerName = `transitforge-dev-${account}-fixed-egress-provider`;
  const arn = `arn:aws:lambda:ap-northeast-1:${account}:function:${name}`, providerArn = arn.replace(name, providerName);
  const env = { VIEWER_ORIGIN: "https://app.ohmyki.com", AGENT_STREAM_PATH: "/api/agent-stream", AGENT_STREAM_ENABLED: "true",
    SERVER_AGENT_MAX_EXECUTION_MS: "120000", FIXED_EGRESS_PROVIDER_FUNCTION_ARN: providerArn,
    SERVER_STATE_TABLE_NAME: `transitforge-dev-${account}-server-state`, COGNITO_USER_POOL_ID: pool, COGNITO_CLIENT_ID: "synthetic-client",
    AGENT_PROVIDER_SECRET_ARN: `arn:aws:secretsmanager:ap-northeast-1:${account}:secret:${name}-providers-ABCDEF` };
  const responses = {
    "sts/get-caller-identity": { Account: account },
    agent: { State: "Active", Environment: { Variables: env }, FunctionArn: arn, Role: `arn:aws:iam::${account}:role/${name}` },
    provider: { State: "Active", VpcConfig: { SubnetIds: ["synthetic-subnet"] }, FunctionArn: providerArn,
      Environment: { Variables: { FIXED_EGRESS_TRAVEL_SECRET_ARN: `arn:aws:secretsmanager:ap-northeast-1:${account}:secret:/transitforge/dev/fixed-egress-travel-provider-ABCDEF` } } },
    "lambda/list-function-url-configs": { FunctionUrlConfigs: [] },
    "lambda/get-policy": { Policy: JSON.stringify({ Statement: [{ Effect: "Allow", Action: "lambda:InvokeFunction", Principal: { Service: "apigateway.amazonaws.com" },
      Condition: { ArnLike: { "AWS:SourceArn": `arn:aws:execute-api:ap-northeast-1:${account}:${api}/dev/POST/api/agent-stream` } } }] }) },
    "apigateway/get-rest-apis": { items: [{ name, id: api, endpointConfiguration: { types: ["REGIONAL"] } }] },
    "apigateway/get-resources": { items: [{ path: "/api/agent-stream", id: "route" }] },
    "apigateway/get-method": { authorizationType: "COGNITO_USER_POOLS", authorizationScopes: ["raiquora/user"], authorizerId: "authorizer" },
    "apigateway/get-authorizer": { type: "COGNITO_USER_POOLS", providerARNs: [`arn:aws:cognito-idp:ap-northeast-1:${account}:userpool/${pool}`] },
    "apigateway/get-integration": { type: "AWS_PROXY", responseTransferMode: "STREAM", uri: `${arn}/response-streaming-invocations` },
    "cloudfront/list-distributions": { DistributionList: { IsTruncated: false, Items: [{ Enabled: true, Status: "Deployed", Aliases: { Items: ["app.ohmyki.com"] },
      CacheBehaviors: { Items: [{ PathPattern: "/api/agent-stream", TargetOriginId: name, Compress: false, CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac" }] },
      Origins: { Items: [{ Id: name, DomainName: `${api}.execute-api.ap-northeast-1.amazonaws.com`, OriginPath: "/dev", CustomOriginConfig: { OriginProtocolPolicy: "https-only", OriginReadTimeout: 60 } }] } }] } },
    "iam/list-role-policies": { PolicyNames: ["synthetic-invoke"] },
    "iam/get-role-policy": { PolicyDocument: { Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: [providerArn] }] } },
    "cognito-idp/describe-user-pool": { UserPool: { Domain: "synthetic-login" } },
    "cognito-idp/describe-user-pool-client": { UserPoolClient: { AllowedOAuthFlowsUserPoolClient: true, AllowedOAuthFlows: ["code"], ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
      AllowedOAuthScopes: ["openid", "email", "raiquora/user"], CallbackURLs: ["https://app.ohmyki.com/index.html"] } },
  };
  change(responses);
  const calls = [];
  return { calls, call: async (service, operation, input) => {
    calls.push(operation);
    if (service === "lambda" && operation === "get-function-configuration") return responses[input.FunctionName === name ? "agent" : "provider"];
    if (service === "lambda" && operation === "get-policy" && input.FunctionName === providerName) return undefined;
    assert.ok(Object.hasOwn(responses, `${service}/${operation}`));
    return responses[`${service}/${operation}`];
  } };
}
test("discovery derives Provider identity from deployed config and verifies real auth/ingress without mutation", async () => {
  const f = fixture(), config = await discover(f.call);
  assert.equal(config.userPoolId, "ap-northeast-1_synthetic");
  assert.equal(config.providerName, "transitforge-dev-123456789012-fixed-egress-provider");
  assert.ok(f.calls.every(operation => /^(get|list|describe)-/u.test(operation)));
});
test("public URLs, missing scope, buffering, altered deadline and unsafe client configuration fail closed", async () => {
  for (const change of [
    r => { r["lambda/list-function-url-configs"].FunctionUrlConfigs.push({ AuthType: "NONE" }); },
    r => { r["apigateway/get-method"].authorizationScopes = []; },
    r => { r["apigateway/get-integration"].responseTransferMode = "BUFFERED"; },
    r => { r.agent.Environment.Variables.SERVER_AGENT_MAX_EXECUTION_MS = "180000"; },
    r => { r["cognito-idp/describe-user-pool-client"].UserPoolClient.ExplicitAuthFlows.push("ALLOW_USER_PASSWORD_AUTH"); },
    r => { r["cloudfront/list-distributions"].DistributionList.Items[0].CacheBehaviors.Items[0].Compress = true; },
  ]) await assert.rejects(discover(fixture(change).call), /validation failed/u);
});
