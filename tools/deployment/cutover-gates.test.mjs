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
