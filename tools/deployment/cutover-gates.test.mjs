import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cutoverGates, reviewCutoverPlan } from "./cutover-gates.mjs";
const env = (stream = "false", provider = "false", browser = "false") => ({
  TF_VAR_agent_stream_enabled: stream, TF_VAR_enable_fixed_egress_provider: provider, VITE_SERVER_AGENT_ENABLED: browser,
});
const change = (name, actions, before = null) => ({ mode: "managed", name, address: `aws_lambda_function.${name}`, change: { actions, before } });
const plan = (resources = [], stream = false, provider = false) => ({ format_version: "1.2", complete: true, variables: {
  agent_stream_enabled: { value: stream }, enable_fixed_egress_provider: { value: provider },
}, resource_changes: resources });

test("only explicit, consistent gates allow OFF, Provider preparation, stream preparation and Browser cutover", () => {
  for (const gates of [env(), env("false", "true"), env("true", "true"), env("true", "true", "true")]) assert.doesNotThrow(() => cutoverGates(gates));
  for (const key of Object.keys(env())) for (const value of [undefined, "", "TRUE", "0", " false", "false\n"]) {
    assert.throws(() => cutoverGates({ ...env(), [key]: value }), /explicitly/);
  }
  for (const gates of [env("false", "false", "true"), env("true", "false"), env("false", "true", "true")]) assert.throws(() => cutoverGates(gates), /requires/);
});
test("cannot turn existing infrastructure off, delete it or replace it even with gates ON", () => {
  for (const name of ["agent_stream", "agent_stream_providers", "agent_stream_gateway_logs", "fixed_egress_provider", "fixed_egress_travel_provider", "invoke_fixed_egress_provider"]) {
    for (const actions of [["delete"], ["delete", "create"], ["create", "delete"]]) {
      assert.throws(() => reviewCutoverPlan(plan([change(name, actions, {})], true, true), env("true", "true")), /deletion/);
    }
    assert.throws(() => reviewCutoverPlan(plan([change(name, ["no-op"], {})]), env()), /cannot be disabled/);
  }
});
test("destructive cutover diagnostics contain only the validated address and actions", () => {
  const input = plan([{
    mode: "managed",
    name: "agent_stream",
    address: 'aws_api_gateway_deployment.agent_stream["stream"]',
    change: {
      actions: ["create", "delete"],
      before: { id: "arn:aws:execute-api:secret-before", secret: "DO_NOT_PRINT_BEFORE" },
      after: { id: "arn:aws:execute-api:secret-after", secret: "DO_NOT_PRINT_AFTER" },
    },
  }], true, true);
  assert.throws(() => reviewCutoverPlan(input, env("true", "true")), error => {
    assert.match(error.message, /aws_api_gateway_deployment\.agent_stream\["stream"\] \(create\/delete\)/u);
    assert.doesNotMatch(error.message, /before|after|arn:|DO_NOT_PRINT/u);
    return true;
  });
});
test("allows only the exact agent stream API Gateway deployment rotation", () => {
  const deployment = {
    mode: "managed",
    type: "aws_api_gateway_deployment",
    name: "agent_stream",
    address: 'aws_api_gateway_deployment.agent_stream["stream"]',
    change: { actions: ["create", "delete"], before: { id: "arn:aws:execute-api:DO_NOT_PRINT_BEFORE" }, after: { secret_string: "DO_NOT_PRINT_AFTER" } },
  };
  assert.equal(
    reviewCutoverPlan(plan([deployment], true, true), env("true", "true")),
    'Terraform plan: resource actions only; sensitive values omitted.\ncreate/delete aws_api_gateway_deployment.agent_stream["stream"]\n',
  );
  for (const actions of [["delete"], ["delete", "create"], ["create", "delete", "create"], ["create", "delete", "no-op"]]) {
    assert.throws(() => reviewCutoverPlan(plan([{ ...deployment, change: { actions, before: {} } }], true, true), env("true", "true")), /deletion/);
  }
  for (const address of ['aws_api_gateway_deployment.agent_stream', 'aws_api_gateway_deployment.agent_stream["other"]', 'aws_lambda_function.agent_stream["stream"]']) {
    assert.throws(() => reviewCutoverPlan(plan([{ ...deployment, address }], true, true), env("true", "true")), /deletion/);
  }
  assert.throws(() => reviewCutoverPlan(plan([{ ...deployment, address: 'invalid address DO_NOT_PRINT' }], true, true), env("true", "true")), /^Error: Invalid Terraform resource address$/);
  assert.throws(() => reviewCutoverPlan(plan([deployment], false, true), env("false", "true")), /deletion/);
});
test("does not allow the same create/delete rotation for other cutover resources", () => {
  for (const resource of [
    { type: "aws_lambda_function", name: "agent_stream", address: 'aws_lambda_function.agent_stream["stream"]' },
    ...[
      ["aws_api_gateway_rest_api", "agent_stream"],
      ["aws_api_gateway_deployment", "agent_stream_other"],
      ["aws_secretsmanager_secret", "agent_stream_providers"],
      ["aws_secretsmanager_secret", "fixed_egress_travel_provider"],
      ["aws_iam_role", "agent_stream"],
      ["aws_iam_role", "fixed_egress_provider"],
      ["aws_vpc", "ai_egress"],
      ["aws_eip", "ai_egress"],
      ["aws_instance", "ai_nat"],
      ["aws_eip_association", "ai_nat"],
    ].map(([type, name]) => ({ type, name, address: `${type}.${name}` })),
    { type: "aws_lambda_function", name: "fixed_egress_provider", address: 'aws_lambda_function.fixed_egress_provider["0"]' },
  ]) {
    for (const actions of [["create", "delete"], ["delete"], ["delete", "create"]]) {
      assert.throws(() => reviewCutoverPlan(plan([{ ...resource, mode: "managed", change: { actions, before: {} } }], true, true), env("true", "true")), /deletion/);
    }
  }
});
test("malformed destructive addresses fail generically without exposing plan values", () => {
  const input = plan([{
    mode: "managed",
    name: "agent_stream",
    address: 'invalid address secret="DO_NOT_PRINT"',
    change: { actions: ["delete"], before: { secret: "DO_NOT_PRINT" } },
  }], true, true);
  assert.throws(() => reviewCutoverPlan(input, env("true", "true")), error => {
    assert.equal(error.message, "Invalid Terraform resource address");
    assert.doesNotMatch(error.message, /DO_NOT_PRINT|invalid address/u);
    return true;
  });
});
test("partial API Gateway logs policy migration keeps the inline policy and creates only the managed attachment", () => {
  const inlinePolicy = {
    mode: "managed",
    name: "agent_stream_gateway_logs",
    address: 'aws_iam_role_policy.agent_stream_gateway_logs["stream"]',
    change: { actions: ["no-op"], before: { id: "existing-inline-policy" } },
  };
  const managedAttachment = {
    mode: "managed",
    name: "agent_stream_gateway_logs",
    address: 'aws_iam_role_policy_attachment.agent_stream_gateway_logs["stream"]',
    change: { actions: ["create"], before: null },
  };
  assert.doesNotThrow(() => reviewCutoverPlan(plan([inlinePolicy, managedAttachment], true, true), env("true", "true")));
});
test("Browser-only rollback preserves infrastructure and can proceed", () => {
  assert.doesNotThrow(() => reviewCutoverPlan(plan([change("agent_stream", ["no-op"], {}), change("fixed_egress_provider", ["update"], {})], true, true), env("true", "true", "false")));
});
test("fails closed on missing/mismatched/incomplete plans", () => {
  for (const input of [null, {}, { ...plan(), complete: false }, { ...plan(), errored: true }, plan([], true, true)]) {
    assert.throws(() => reviewCutoverPlan(input, env()));
  }
});
test("safe summary never includes resource values, secrets or outputs", () => {
  const input = plan([change("agent_stream", ["create"])], true, true);
  input.resource_changes[0].change.after = { secret_string: "DO_NOT_PRINT" };
  input.outputs = { secret: "DO_NOT_PRINT" };
  assert.equal(reviewCutoverPlan(input, env("true", "true")), "Terraform plan: resource actions only; sensitive values omitted.\ncreate aws_lambda_function.agent_stream\n");
});
test("CLI fails nonzero for a deleted gate, malformed JSON and destructive plan without disclosing input", () => {
  const run = (input, gates) => spawnSync(process.execPath, [new URL("./cutover-gates.mjs", import.meta.url).pathname, "plan"], { env: { ...process.env, ...gates }, input, encoding: "utf8" });
  for (const [input, gates] of [["PRIVATE_INVALID_JSON", env()], [JSON.stringify(plan()), env("")], [JSON.stringify(plan([change("agent_stream", ["delete"], {})])), env()]]) {
    const result = run(input, gates); assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /PRIVATE_INVALID_JSON/);
  }
});

test("Terraform TF_VAR/CLI strings and typed tfvars booleans have identical gate semantics", () => {
  for (const enabled of [false, true]) {
    const input = plan([], enabled, enabled);
    const gates = env(String(enabled), String(enabled));
    assert.doesNotThrow(() => reviewCutoverPlan(input, gates));
    input.variables.agent_stream_enabled.value = String(enabled);
    input.variables.enable_fixed_egress_provider.value = String(enabled);
    assert.doesNotThrow(() => reviewCutoverPlan(input, gates));
    for (const invalid of ["TRUE", "0", 1, null, "", "false\n"]) {
      input.variables.agent_stream_enabled.value = invalid;
      assert.throws(() => reviewCutoverPlan(input, gates), /differ/);
    }
  }
});
