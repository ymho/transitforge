import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const workflow = readFileSync(new URL("../../.github/workflows/cd.yml", import.meta.url), "utf8");
const steps = workflow.split(/^      - name: /mu).slice(1);

test("manual runs default to plan; missing gates never fall back to false", () => {
  assert.match(workflow, /options: \[plan, deploy\]\s+default: plan/u);
  assert.match(workflow, /inputs.mode \|\| 'plan'/u);
  for (const [target, source] of [
    ["TF_VAR_agent_stream_enabled", "AGENT_STREAM_ENABLED"],
    ["TF_VAR_enable_fixed_egress_provider", "FIXED_EGRESS_PROVIDER_ENABLED"],
    ["VITE_SERVER_AGENT_ENABLED", "SERVER_AGENT_ENABLED"],
  ]) assert.ok(workflow.includes(`${target}: \${{ vars.${source} }}`));
  assert.ok(workflow.indexOf("cutover-gates.mjs inputs") < workflow.indexOf("Configure AWS credentials"));
  assert.match(workflow, /cancel-in-progress: false/u);
});
test("every deploy side effect is guarded, and plan-only does not write AWS locks", () => {
  const mutations = steps.filter(step => /terraform apply|aws s3 sync|aws cloudfront create-invalidation/u.test(step));
  assert.equal(mutations.length, 2);
  for (const step of mutations) assert.match(step, /if: env.CD_MODE == 'deploy'/u);
  const planning = steps.find(step => step.startsWith("Plan Terraform"));
  assert.match(planning, /if \[ "\$CD_MODE" = plan \]; then lock=false; fi/u);
  assert.match(planning, /use_lockfile=\$\{lock\}/u);
  assert.match(planning, /terraform plan -input=false -lock="\$lock"/u);
  assert.ok(planning.indexOf("cutover-gates.mjs plan") > planning.indexOf("terraform plan"));
  assert.ok(workflow.indexOf("cutover-gates.mjs plan") < workflow.indexOf("terraform apply"));
});
test("plan values are not logged or uploaded", () => {
  assert.match(workflow, /terraform_wrapper: false/u);
  assert.match(workflow, /> plan.log 2>&1/u);
  assert.doesNotMatch(workflow, /cat plan.log|upload-artifact/u);
  assert.match(workflow, /if: always\(\)[\s\S]+rm -f dev.tfplan plan.log/u);
});
