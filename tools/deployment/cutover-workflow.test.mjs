import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { japanAccessRolloutReady, japanAccessDeploymentInputs, reviewCutoverPlan } from "./cutover-gates.mjs";
const workflow = readFileSync(new URL("../../.github/workflows/cd.yml", import.meta.url), "utf8");
const steps = workflow.split(/^      - name: /mu).slice(1);

test("Japan access rollout requires explicit readiness and fails closed", () => {
  for (const value of [undefined, "false", "TRUE", "1", " true "]) {
    assert.throws(() => japanAccessRolloutReady({ JAPAN_ACCESS_ROLLOUT_READY: value }), /Japan access preparation is required/u);
  }
  assert.doesNotThrow(() => japanAccessRolloutReady({ JAPAN_ACCESS_ROLLOUT_READY: "true" }));
  for (const [value, status] of [["false", 1], ["true", 0]]) {
    const result = spawnSync(process.execPath, [new URL("./cutover-gates.mjs", import.meta.url).pathname, "japan-access"], {
      env: { ...process.env, JAPAN_ACCESS_ROLLOUT_READY: value }, encoding: "utf8",
    });
    assert.equal(result.status, status);
  }
});

test("deploy readiness is checked before AWS access; plan remains available", () => {
  assert.ok(workflow.includes("JAPAN_ACCESS_ROLLOUT_READY: ${{ vars.JAPAN_ACCESS_ROLLOUT_READY || 'false' }}"));
  const gate = steps.find(step => step.includes("cutover-gates.mjs japan-access"));
  assert.match(gate, /if: env.CD_MODE == 'deploy'/u);
  assert.ok(workflow.indexOf("cutover-gates.mjs japan-access") < workflow.indexOf("Configure AWS credentials"));
});

test("manual runs default to plan; fixed-egress input never falls back to false", () => {
  assert.match(workflow, /options: \[plan, japan-prepare, deploy\]\s+default: plan/u);
  assert.match(workflow, /inputs.mode \|\| 'plan'/u);
  assert.ok(workflow.includes("TF_VAR_enable_fixed_egress_provider: ${{ vars.FIXED_EGRESS_PROVIDER_ENABLED }}"));
  assert.doesNotMatch(workflow, /AGENT_STREAM_ENABLED|SERVER_AGENT_ENABLED|VITE_SERVER_AGENT_ENABLED/u);
  assert.ok(workflow.indexOf("cutover-gates.mjs inputs") < workflow.indexOf("Configure AWS credentials"));
  assert.match(workflow, /cancel-in-progress: false/u);
});
test("every deploy side effect is guarded, and plan-only does not write AWS locks", () => {
  const mutations = steps.filter(step => /terraform apply|aws s3 sync|aws cloudfront create-invalidation/u.test(step));
  assert.equal(mutations.length, 2);
  for (const step of mutations) {
    assert.match(step, /if: env.CD_MODE == 'deploy'/u);
    if (/terraform apply/u.test(step)) assert.match(step, /\|\| env.CD_MODE == 'japan-prepare'/u);
    else assert.doesNotMatch(step, /japan-prepare/u);
  }
  const planning = steps.find(step => step.startsWith("Plan Terraform"));
  assert.match(planning, /if \[ "\$CD_MODE" = plan \]; then lock=false; fi/u);
  assert.match(planning, /use_lockfile=\$\{lock\}/u);
  assert.match(planning, /terraform plan -input=false -lock="\$lock"/u);
  assert.ok(planning.indexOf("cutover-gates.mjs plan") > planning.indexOf("terraform plan"));
  assert.ok(workflow.indexOf("cutover-gates.mjs plan") < workflow.indexOf("terraform apply"));
});

test("preparation cannot enforce API keys or country filtering, including in the actual plan", () => {
  for (const mode of ["plan", "japan-prepare", "deploy"]) {
    const enforcing = mode !== "japan-prepare";
    const environment = {
      CD_MODE: mode, TF_VAR_enable_fixed_egress_provider: "true",
      TF_VAR_require_cloudfront_origin_key: String(enforcing), TF_VAR_enforce_japan_country: String(enforcing),
    };
    const plan = {format_version: "1.2", resource_changes: [], variables: {
      enable_fixed_egress_provider: {value: true}, require_cloudfront_origin_key: {value: enforcing}, enforce_japan_country: {value: enforcing},
    }};
    assert.equal(japanAccessDeploymentInputs(environment), enforcing);
    assert.doesNotThrow(() => reviewCutoverPlan(plan, environment));
    for (const name of ["require_cloudfront_origin_key", "enforce_japan_country"]) {
      assert.throws(() => japanAccessDeploymentInputs({...environment, [`TF_VAR_${name}`]: String(!enforcing)}));
      assert.throws(() => reviewCutoverPlan({...plan, variables: {...plan.variables, [name]: {value: !enforcing}}}, environment));
    }
  }
  assert.throws(() => japanAccessDeploymentInputs({CD_MODE: "prepare"}));
  assert.throws(() => reviewCutoverPlan({format_version: "1.2", variables: {
    enable_fixed_egress_provider: {value: true}, require_cloudfront_origin_key: {value: false}, enforce_japan_country: {value: false},
  }, resource_changes: [{mode: "managed", type: "aws_api_gateway_method", name: "trip_api_post", address: "aws_api_gateway_method.trip_api_post", change: {actions: ["update"], before: {api_key_required: true}}}]}, {
    CD_MODE: "japan-prepare", TF_VAR_enable_fixed_egress_provider: "true", TF_VAR_require_cloudfront_origin_key: "false", TF_VAR_enforce_japan_country: "false",
  }), /cannot disable an already enforced API key/u);
  assert.ok(workflow.indexOf("cutover-gates.mjs japan-inputs") < workflow.indexOf("Configure AWS credentials"));
  const readback = steps.find(step => step.startsWith("Verify prepared origin keys"));
  assert.match(readback, /if: env.CD_MODE == 'japan-prepare'/u);
});
test("plan values are not logged or uploaded", () => {
  assert.match(workflow, /terraform_wrapper: false/u);
  assert.match(workflow, /> plan.log 2>&1/u);
  assert.doesNotMatch(workflow, /cat plan.log|upload-artifact/u);
  assert.match(workflow, /if: always\(\)[\s\S]+rm -f dev.tfplan plan.log/u);
});
