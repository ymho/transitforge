#!/usr/bin/env bash
# One-shot, reversible AWS dev hibernation. Do not delete persistent data.
set -euo pipefail
export AWS_PAGER=""

: "$AWS_DEPLOY_ROLE_ARN"
: "$TF_STATE_BUCKET"
: "$AWS_REGION"

account="$(aws sts get-caller-identity --query Account --output text)"
expected_role="arn:aws:iam::$account:role/transitforge-dev-github-deploy"
if [[ "$AWS_DEPLOY_ROLE_ARN" != "$expected_role" ]]; then
  echo "Refusing to pause: OIDC role is not the dedicated TransitForge dev deployment role." >&2
  exit 1
fi
if [[ "$AWS_REGION" != "ap-northeast-1" ]]; then
  echo "Refusing to pause: unexpected region." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "## TransitForge / RAIQUORA AWS hibernation" >> "$GITHUB_STEP_SUMMARY"
echo "No S3 objects, DynamoDB items, backups, Terraform state or GitHub code are deleted." >> "$GITHUB_STEP_SUMMARY"

# Read only the infrastructure addresses; never print or upload the Terraform state.
(
  cd infra/terraform/environments/dev
  terraform init -input=false -no-color \
    -backend-config="bucket=$TF_STATE_BUCKET" \
    -backend-config="region=$AWS_REGION" > "$tmpdir/tf-init.log"
  terraform state pull | jq -r '
    .resources[]
    | select(.type == "aws_cloudfront_distribution")
    | select(.name == "website" or .name == "viewer")
    | .instances[].attributes.id
  ' | sort -u > "$tmpdir/distribution-ids"
)

# Stop serving the public website and API through either CloudFront distribution.
cf_count=0
while IFS= read -r distribution_id; do
  [[ -n "$distribution_id" ]] || continue
  aws cloudfront get-distribution-config --id "$distribution_id" --output json > "$tmpdir/cf.json"
  if [[ "$(jq -r '.DistributionConfig.Enabled' "$tmpdir/cf.json")" == "true" ]]; then
    etag="$(jq -r '.ETag' "$tmpdir/cf.json")"
    jq '.DistributionConfig | .Enabled = false' "$tmpdir/cf.json" > "$tmpdir/cf-disabled.json"
    aws cloudfront update-distribution --id "$distribution_id" \
      --if-match "$etag" --distribution-config "file://$tmpdir/cf-disabled.json" >/dev/null
  fi
  cf_count=$((cf_count + 1))
done < "$tmpdir/distribution-ids"
echo "- CloudFront distributions disabled / confirmed: $cf_count" >> "$GITHUB_STEP_SUMMARY"

# Disable every TransitForge data-builder schedule, including traffic and graph rebuilds.
scheduler_count=0
aws scheduler list-schedule-groups --name-prefix "transitforge-dev-data-builder" --output json > "$tmpdir/schedule-groups.json"
jq -r '.ScheduleGroups[].Name' "$tmpdir/schedule-groups.json" > "$tmpdir/group-names"
echo "default" >> "$tmpdir/group-names"
while IFS= read -r group; do
  [[ -n "$group" ]] || continue
  if [[ "$group" == "default" ]]; then
    aws scheduler list-schedules --group-name "$group" --name-prefix "transitforge-dev-" --output json > "$tmpdir/schedules.json"
  else
    aws scheduler list-schedules --group-name "$group" --output json > "$tmpdir/schedules.json"
  fi
  jq -r '.Schedules[] | select(.State == "ENABLED") | .Name' "$tmpdir/schedules.json" > "$tmpdir/schedule-names"
  while IFS= read -r schedule; do
    [[ -n "$schedule" ]] || continue
    aws scheduler get-schedule --group-name "$group" --name "$schedule" --output json > "$tmpdir/schedule.json"
    jq '{
      Name, GroupName, ScheduleExpression, ScheduleExpressionTimezone,
      FlexibleTimeWindow, Target, StartDate, EndDate, Description,
      KmsKeyArn, ActionAfterCompletion
    } | with_entries(select(.value != null)) | .State = "DISABLED"' \
      "$tmpdir/schedule.json" > "$tmpdir/schedule-disabled.json"
    aws scheduler update-schedule --cli-input-json "file://$tmpdir/schedule-disabled.json" >/dev/null
    scheduler_count=$((scheduler_count + 1))
  done < "$tmpdir/schedule-names"
done < "$tmpdir/group-names"
echo "- EventBridge Scheduler schedules switched off: $scheduler_count" >> "$GITHUB_STEP_SUMMARY"

# Legacy EventBridge scheduled rules include the 1-minute TripChanged / recheck workers.
rule_count=0
aws events list-rules --name-prefix "transitforge-dev-" --output json > "$tmpdir/event-rules.json"
jq -r '.Rules[] | select(.ScheduleExpression != null and .State != "DISABLED") | .Name' \
  "$tmpdir/event-rules.json" > "$tmpdir/scheduled-rule-names"
while IFS= read -r rule; do
  [[ -n "$rule" ]] || continue
  aws events disable-rule --name "$rule"
  rule_count=$((rule_count + 1))
done < "$tmpdir/scheduled-rule-names"
echo "- EventBridge scheduled rules switched off: $rule_count" >> "$GITHUB_STEP_SUMMARY"

# Scale down OTP and any other TransitForge dev ECS services; stop standalone Fargate tasks.
service_count=0
task_count=0
aws ecs list-clusters --output json > "$tmpdir/ecs-clusters.json"
jq -r '.clusterArns[] | select(split("/")[-1] | startswith("transitforge-dev-"))' \
  "$tmpdir/ecs-clusters.json" > "$tmpdir/project-clusters"
while IFS= read -r cluster; do
  [[ -n "$cluster" ]] || continue
  aws ecs list-services --cluster "$cluster" --output json > "$tmpdir/ecs-services.json"
  jq -r '.serviceArns[]' "$tmpdir/ecs-services.json" > "$tmpdir/project-services"
  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    aws ecs update-service --cluster "$cluster" --service "$service" --desired-count 0 >/dev/null
    service_count=$((service_count + 1))
  done < "$tmpdir/project-services"
  aws ecs list-tasks --cluster "$cluster" --desired-status RUNNING --output json > "$tmpdir/ecs-tasks.json"
  jq -r '.taskArns[]' "$tmpdir/ecs-tasks.json" > "$tmpdir/project-tasks"
  while IFS= read -r task; do
    [[ -n "$task" ]] || continue
    aws ecs stop-task --cluster "$cluster" --task "$task" \
      --reason "TransitForge dev hibernation / cost reduction" >/dev/null
    task_count=$((task_count + 1))
  done < "$tmpdir/project-tasks"
done < "$tmpdir/project-clusters"
echo "- ECS services scaled to zero: $service_count; running Fargate tasks asked to stop: $task_count" >> "$GITHUB_STEP_SUMMARY"

# Stop only the NAT EC2 with the Terraform-specific IAM instance profile.
# Its EIP and EBS remain allocated for an easy restore and may still incur charges.
nat_profile="transitforge-dev-$account-ai-nat"
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=transitforge" \
            "Name=tag:Environment,Values=dev" \
            "Name=instance-state-name,Values=running" \
  --output json > "$tmpdir/ec2-instances.json"
jq -r --arg p "$nat_profile" '
  .Reservations[].Instances[]
  | select((.IamInstanceProfile.Arn // "") | endswith("/" + $p))
  | .InstanceId
' "$tmpdir/ec2-instances.json" > "$tmpdir/nat-instance-ids"
nat_count=0
while IFS= read -r instance_id; do
  [[ -n "$instance_id" ]] || continue
  aws ec2 stop-instances --instance-ids "$instance_id" >/dev/null
  nat_count=$((nat_count + 1))
done < "$tmpdir/nat-instance-ids"
echo "- NAT EC2 instances requested to stop: $nat_count" >> "$GITHUB_STEP_SUMMARY"

# Suppress expected alarms while the polling processes are deliberately stopped.
aws cloudwatch describe-alarms --alarm-name-prefix "transitforge-dev-" --output json > "$tmpdir/alarms.json"
jq -r '.MetricAlarms[].AlarmName' "$tmpdir/alarms.json" > "$tmpdir/alarm-names"
alarm_count=0
while IFS= read -r alarm; do
  [[ -n "$alarm" ]] || continue
  aws cloudwatch disable-alarm-actions --alarm-names "$alarm"
  alarm_count=$((alarm_count + 1))
done < "$tmpdir/alarm-names"
echo "- Alarm notifications silenced (alarms retained): $alarm_count" >> "$GITHUB_STEP_SUMMARY"
echo "- Remaining possible charges: retained S3 / ECR / EBS / EIP / DynamoDB PITR / Secrets Manager / S3 Vectors / CloudWatch." >> "$GITHUB_STEP_SUMMARY"
echo "AWS pause API requests completed. CloudFront and ECS shutdown may still be propagating."
