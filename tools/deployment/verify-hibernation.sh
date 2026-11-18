#!/usr/bin/env bash
# Read-only post-hibernation audit; fail if known continuous-cost services are still active.
set -euo pipefail
export AWS_PAGER=""
: "$AWS_DEPLOY_ROLE_ARN"
: "$TF_STATE_BUCKET"
: "$AWS_REGION"
account="$(aws sts get-caller-identity --query Account --output text)"
[[ "$AWS_REGION" == "ap-northeast-1" ]]
[[ "$AWS_DEPLOY_ROLE_ARN" == "arn:aws:iam::$account:role/transitforge-dev-github-deploy" ]]

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
failed=0

(
  cd infra/terraform/environments/dev
  terraform init -input=false -no-color \
    -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="region=$AWS_REGION" > "$tmpdir/init.log"
  terraform state pull | jq -r '.resources[] | select(.type == "aws_cloudfront_distribution") | select(.name == "website" or .name == "viewer") | .instances[].attributes.id' > "$tmpdir/distributions"
)
cf=0
while IFS= read -r distribution_id; do
  [[ -n "$distribution_id" ]] || continue
  enabled="$(aws cloudfront get-distribution-config --id "$distribution_id" --query 'DistributionConfig.Enabled' --output text)"
  status="$(aws cloudfront get-distribution --id "$distribution_id" --query 'Distribution.Status' --output text)"
  echo "CloudFront: enabled=$enabled, deployment=$status"
  [[ "$enabled" == "False" ]] || failed=1
  cf=$((cf + 1))
done < "$tmpdir/distributions"
[[ "$cf" -ge 1 ]] || failed=1

aws scheduler list-schedule-groups --name-prefix "transitforge-dev-data-builder" --output json \
  | jq -r '.ScheduleGroups[].Name' > "$tmpdir/groups"
echo default >> "$tmpdir/groups"
schedules=0
enabled_schedules=0
while IFS= read -r group; do
  if [[ "$group" == "default" ]]; then
    aws scheduler list-schedules --group-name "$group" --name-prefix "transitforge-dev-" --output json > "$tmpdir/schedules"
  else
    aws scheduler list-schedules --group-name "$group" --output json > "$tmpdir/schedules"
  fi
  total="$(jq '.Schedules | length' "$tmpdir/schedules")"
  enabled="$(jq '[.Schedules[] | select(.State == "ENABLED")] | length' "$tmpdir/schedules")"
  schedules=$((schedules + total))
  enabled_schedules=$((enabled_schedules + enabled))
done < "$tmpdir/groups"
echo "EventBridge Scheduler: total=$schedules, enabled=$enabled_schedules"
[[ "$enabled_schedules" -eq 0 ]] || failed=1

aws events list-rules --name-prefix "transitforge-dev-" --output json > "$tmpdir/rules"
rules="$(jq '[.Rules[] | select(.ScheduleExpression != null)] | length' "$tmpdir/rules")"
enabled_rules="$(jq '[.Rules[] | select(.ScheduleExpression != null and .State != "DISABLED")] | length' "$tmpdir/rules")"
echo "EventBridge scheduled rules: total=$rules, enabled=$enabled_rules"
[[ "$enabled_rules" -eq 0 ]] || failed=1

aws ecs list-clusters --output json | jq -r '.clusterArns[] | select(split("/")[-1] | startswith("transitforge-dev-"))' > "$tmpdir/clusters"
ecs_services=0
ecs_running=0
while IFS= read -r cluster; do
  [[ -n "$cluster" ]] || continue
  aws ecs list-services --cluster "$cluster" --output json | jq -r '.serviceArns[]' > "$tmpdir/services"
  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    aws ecs describe-services --cluster "$cluster" --services "$service" --output json > "$tmpdir/service"
    desired="$(jq -r '.services[0].desiredCount' "$tmpdir/service")"
    running="$(jq -r '.services[0].runningCount' "$tmpdir/service")"
    echo "ECS service: desired=$desired, running=$running"
    [[ "$desired" -eq 0 && "$running" -eq 0 ]] || failed=1
    ecs_services=$((ecs_services + 1))
    ecs_running=$((ecs_running + running))
  done < "$tmpdir/services"
  aws ecs list-tasks --cluster "$cluster" --desired-status RUNNING --output json > "$tmpdir/tasks"
  stray="$(jq '.taskArns | length' "$tmpdir/tasks")"
  echo "ECS cluster still-running tasks: $stray"
  [[ "$stray" -eq 0 ]] || failed=1
done < "$tmpdir/clusters"

aws ec2 describe-instances --filters "Name=tag:Project,Values=transitforge" "Name=tag:Environment,Values=dev" --output json > "$tmpdir/instances"
jq -r --arg p "transitforge-dev-$account-ai-nat" '
  .Reservations[].Instances[]
  | select((.IamInstanceProfile.Arn // "") | endswith("/" + $p))
  | .State.Name
' "$tmpdir/instances" > "$tmpdir/nat-states"
nat_count="$(wc -l < "$tmpdir/nat-states" | tr -d ' ')"
echo "NAT instances found=$nat_count, states=$(paste -sd, "$tmpdir/nat-states")"
[[ "$nat_count" -eq 1 ]] || failed=1
while IFS= read -r state; do
  [[ "$state" == "stopped" ]] || failed=1
done < "$tmpdir/nat-states"

{
  echo "## Verified AWS hibernation"
  echo "- CloudFront distributions: $cf (Enabled=false)"
  echo "- Scheduler jobs: $schedules, still enabled: $enabled_schedules"
  echo "- EventBridge scheduled rules: $rules, still enabled: $enabled_rules"
  echo "- ECS services: $ecs_services, running tasks: $ecs_running"
  echo "- NAT EC2 found: $nat_count (expected state: stopped)"
  echo "- S3, DynamoDB, EBS and EIP remain; residual storage/IP charges continue."
} >> "$GITHUB_STEP_SUMMARY"
if [[ "$failed" -ne 0 ]]; then echo "Hibernation verification FAILED." >&2; exit 1; fi
echo "Hibernation verification PASSED."

