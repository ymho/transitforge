import { requireCheck } from "./safety.mjs";
import { secretNames } from "./secrets.mjs";

export const viewerOrigin = "https://app.ohmyki.com";
const agentName = "transitforge-dev-agent-stream";
export async function discover(call) {
  const identity = await call("sts", "get-caller-identity");
  requireCheck(/^\d{12}$/u.test(identity.Account));
  const prefix = `transitforge-dev-${identity.Account}`;
  const agent = await call("lambda", "get-function-configuration", { FunctionName: agentName });
  const providerName = `${prefix}-fixed-egress-provider`;
  const provider = await call("lambda", "get-function-configuration", { FunctionName: providerName });
  const env = agent.Environment?.Variables;
  requireCheck(agent.State === "Active" && provider.State === "Active" && env);
  requireCheck(env.VIEWER_ORIGIN === viewerOrigin && env.AGENT_STREAM_PATH === "/api/agent-stream" && env.AGENT_STREAM_ENABLED === "true");
  requireCheck(env.SERVER_AGENT_MAX_EXECUTION_MS === "120000");
  requireCheck(!(agent.VpcConfig?.SubnetIds?.length) && provider.VpcConfig?.SubnetIds?.length > 0);
  requireCheck(env.FIXED_EGRESS_PROVIDER_FUNCTION_ARN === provider.FunctionArn);
  requireCheck(env.SERVER_STATE_TABLE_NAME === `${prefix}-server-state`);
  requireCheck(env.AGENT_PROVIDER_SECRET_ARN?.startsWith(`arn:aws:secretsmanager:ap-northeast-1:${identity.Account}:secret:${secretNames.agent}-`));
  requireCheck(provider.Environment?.Variables?.FIXED_EGRESS_TRAVEL_SECRET_ARN?.startsWith(`arn:aws:secretsmanager:ap-northeast-1:${identity.Account}:secret:${secretNames.travel}-`));
  for (const functionName of [agentName, providerName]) {
    const urls = await call("lambda", "list-function-url-configs", { FunctionName: functionName });
    requireCheck(urls.FunctionUrlConfigs?.length === 0 && !urls.NextMarker);
  }
  const providerPolicy = await call("lambda", "get-policy", { FunctionName: providerName }, { missing: true });
  requireCheck(providerPolicy === undefined);
  const apis = await call("apigateway", "get-rest-apis", { limit: 500 });
  const matches = apis.items?.filter(item => item.name === agentName);
  requireCheck(matches?.length === 1 && !apis.position);
  const api = matches[0];
  requireCheck(api.endpointConfiguration?.types?.length === 1 && api.endpointConfiguration.types[0] === "REGIONAL");
  const resources = await call("apigateway", "get-resources", { restApiId: api.id, limit: 500 });
  requireCheck(!resources.position);
  const route = resources.items?.find(item => item.path === "/api/agent-stream");
  requireCheck(route);
  const method = await call("apigateway", "get-method", { restApiId: api.id, resourceId: route.id, httpMethod: "POST" });
  requireCheck(method.authorizationType === "COGNITO_USER_POOLS" && method.authorizationScopes?.includes("raiquora/user"));
  const authorizer = await call("apigateway", "get-authorizer", { restApiId: api.id, authorizerId: method.authorizerId });
  requireCheck(authorizer.type === "COGNITO_USER_POOLS" && authorizer.providerARNs?.length === 1 &&
    authorizer.providerARNs[0] === `arn:aws:cognito-idp:ap-northeast-1:${identity.Account}:userpool/${env.COGNITO_USER_POOL_ID}`);
  const integration = await call("apigateway", "get-integration", { restApiId: api.id, resourceId: route.id, httpMethod: "POST" });
  requireCheck(integration.type === "AWS_PROXY" && integration.responseTransferMode === "STREAM" && integration.uri?.includes(`${agent.FunctionArn}/response-streaming-invocations`));
  const distributions = (await call("cloudfront", "list-distributions")).DistributionList;
  requireCheck(!distributions.IsTruncated);
  const viewers = distributions.Items?.filter(item => item.Aliases?.Items?.includes(new URL(viewerOrigin).hostname));
  requireCheck(viewers?.length === 1);
  const viewer = viewers[0];
  requireCheck(viewer.Enabled && viewer.Status === "Deployed");
  const behavior = viewer.CacheBehaviors?.Items?.find(item => item.PathPattern === "/api/agent-stream");
  requireCheck(behavior && behavior.TargetOriginId === agentName && behavior.Compress === false &&
    behavior.CachePolicyId === "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" &&
    behavior.OriginRequestPolicyId === "b689b0a8-53d0-40ab-baf2-68738e2966ac" &&
    !behavior.FunctionAssociations?.Quantity && !behavior.LambdaFunctionAssociations?.Quantity);
  const origin = viewer.Origins?.Items?.find(item => item.Id === agentName);
  requireCheck(origin?.DomainName === `${api.id}.execute-api.ap-northeast-1.amazonaws.com` && origin.OriginPath === "/dev" &&
    origin.CustomOriginConfig?.OriginProtocolPolicy === "https-only" && origin.CustomOriginConfig?.OriginReadTimeout >= 45);
  const policy = JSON.parse((await call("lambda", "get-policy", { FunctionName: agentName })).Policy);
  requireCheck(policy.Statement?.length === 1);
  const statement = policy.Statement[0];
  requireCheck(statement.Effect === "Allow" && statement.Action === "lambda:InvokeFunction" && statement.Principal?.Service === "apigateway.amazonaws.com" &&
    statement.Condition?.ArnLike?.["AWS:SourceArn"] === `arn:aws:execute-api:ap-northeast-1:${identity.Account}:${api.id}/dev/POST/api/agent-stream`);
  const roleName = agent.Role?.split("/").at(-1);
  requireCheck(roleName === agentName);
  const policies = await call("iam", "list-role-policies", { RoleName: roleName });
  let invokeGrant = false;
  for (const name of policies.PolicyNames ?? []) {
    const result = await call("iam", "get-role-policy", { RoleName: roleName, PolicyName: name });
    const document = typeof result.PolicyDocument === "string" ? JSON.parse(decodeURIComponent(result.PolicyDocument)) : result.PolicyDocument;
    for (const entry of document.Statement ?? []) {
      const actions = [].concat(entry.Action ?? []), resources = [].concat(entry.Resource ?? []);
      if (entry.Effect === "Allow" && actions.includes("lambda:InvokeFunction") && resources.length === 1 && resources[0] === provider.FunctionArn) invokeGrant = true;
    }
  }
  requireCheck(invokeGrant);
  const pool = await call("cognito-idp", "describe-user-pool", { UserPoolId: env.COGNITO_USER_POOL_ID });
  const client = (await call("cognito-idp", "describe-user-pool-client", { UserPoolId: env.COGNITO_USER_POOL_ID, ClientId: env.COGNITO_CLIENT_ID })).UserPoolClient;
  requireCheck(!client.ClientSecret && client.AllowedOAuthFlowsUserPoolClient === true &&
    client.AllowedOAuthFlows?.length === 1 && client.AllowedOAuthFlows[0] === "code" &&
    client.ExplicitAuthFlows?.length === 1 && client.ExplicitAuthFlows[0] === "ALLOW_REFRESH_TOKEN_AUTH");
  requireCheck(["openid", "email", "raiquora/user"].every(scope => client.AllowedOAuthScopes.includes(scope)));
  requireCheck(client.CallbackURLs?.includes(`${viewerOrigin}/index.html`) && pool.UserPool?.Domain);
  const loginOrigin = `https://${pool.UserPool.Domain}.auth.ap-northeast-1.amazoncognito.com`;
  return { agentName, providerName, stateTable: env.SERVER_STATE_TABLE_NAME,
    userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID, loginOrigin,
    callbackUrl: `${viewerOrigin}/index.html`, directOrigin: `https://${api.id}.execute-api.ap-northeast-1.amazonaws.com/dev`,
    issuer: `https://cognito-idp.ap-northeast-1.amazonaws.com/${env.COGNITO_USER_POOL_ID}` };
}
