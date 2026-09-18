import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aiEgress = readFileSync(new URL("../../infra/terraform/environments/dev/ai-egress.tf", import.meta.url), "utf8");
const aiNat = aiEgress.match(/resource "aws_instance" "ai_nat" \{([\s\S]*?)\n\}\n\nresource "aws_eip_association"/u)?.[1] ?? "";
const lifecycle = aiNat.match(/lifecycle \{([\s\S]*?)\n  \}/u)?.[1] ?? "";

test("NAT AMI drift is the only ignored ai_nat input during cutover", () => {
  assert.match(lifecycle, /^\s+ignore_changes = \[ami\]\s*$/u);
  assert.match(aiNat, /ami\s+= data\.aws_ssm_parameter\.ai_nat_instance_ami\.value/u);
  assert.doesNotMatch(lifecycle, /ignore_changes\s*=\s*all/u);
  for (const attribute of ["instance_type", "iam_instance_profile", "subnet_id", "vpc_security_group_ids", "user_data", "user_data_replace_on_change"]) {
    assert.doesNotMatch(lifecycle, new RegExp(attribute, "u"));
  }
});
