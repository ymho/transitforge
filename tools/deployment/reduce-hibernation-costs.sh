#!/usr/bin/env bash
# Apply a saved, allowlisted deletion plan. Persistent data is never a target.
set -euo pipefail
export AWS_PAGER=""
: "${AWS_REGION:?}"
: "${AWS_DEPLOY_ROLE_ARN:?}"
: "${TF_STATE_BUCKET:?}"
stack="${1:?main or data-builder}"
case "$stack" in
  main) role=transitforge-dev-github-deploy ;;
  data-builder) role=transitforge-dev-data-builder-github-deploy ;;
  *) exit 1 ;;
esac
[[ "$AWS_REGION" == ap-northeast-1 ]]
account="$(aws sts get-caller-identity --query Account --output text)"
[[ "$AWS_DEPLOY_ROLE_ARN" == "arn:aws:iam::$account:role/$role" ]]
repo_root="$(pwd)"
guard="$repo_root/tools/deployment/hibernation-cost-plan.py"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
umask 077
cd infra/terraform/environments/dev
if ! terraform init -input=false -no-color \
  -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="region=$AWS_REGION" \
  > "$tmpdir/init.log" 2>&1; then
  echo "Terraform initialization failed; private diagnostics withheld." >&2; exit 1
fi
if [[ "$stack" == main ]]; then
  # The approved disk is the bootstrap-only root disk. Reject additional volumes
  # or a root disk that would survive termination; do not risk user data/orphans.
  terraform state pull | jq -r '.resources[] | select(.type == "aws_instance" and .name == "ai_nat") | .instances[].attributes.id' > "$tmpdir/nat-ids"
  : > "$tmpdir/root-volumes"
  while IFS= read -r instance_id; do
    [[ -n "$instance_id" ]] || continue
    aws ec2 describe-instances --instance-ids "$instance_id" --output json > "$tmpdir/nat.json"
    jq -e --arg profile "transitforge-dev-$account-ai-nat" '
      [.Reservations[].Instances[]] as $i |
      ($i | length) == 1 and
      ($i[0] | .State.Name == "stopped" and
        ([.Tags[] | select(.Key == "Project" and .Value == "transitforge")] | length) == 1 and
        ([.Tags[] | select(.Key == "Environment" and .Value == "dev")] | length) == 1 and
        (.IamInstanceProfile.Arn | endswith("/" + $profile)) and
        (.BlockDeviceMappings | length) == 1 and
        .BlockDeviceMappings[0].DeviceName == .RootDeviceName and
        .BlockDeviceMappings[0].Ebs.DeleteOnTermination == true)
    ' "$tmpdir/nat.json" > /dev/null || { echo "NAT root-disk preflight rejected; nothing applied." >&2; exit 1; }
    jq -r '.Reservations[].Instances[].BlockDeviceMappings[].Ebs.VolumeId' "$tmpdir/nat.json" >> "$tmpdir/root-volumes"
  done < "$tmpdir/nat-ids"
fi
mapfile -t targets < <(python3 "$guard" targets "$stack")
[[ "${#targets[@]}" -gt 0 ]]
args=()
for target in "${targets[@]}"; do args+=("-target=$target"); done
if ! terraform plan -input=false -no-color -lock-timeout=5m "${args[@]}" \
  -out="$tmpdir/maintenance.tfplan" > "$tmpdir/plan.log" 2>&1; then
  echo "Targeted Terraform plan failed; private diagnostics withheld." >&2; exit 1
fi
terraform show -json "$tmpdir/maintenance.tfplan" | python3 "$guard" review "$stack" > "$tmpdir/summary"
cat "$tmpdir/summary"
cat "$tmpdir/summary" >> "$GITHUB_STEP_SUMMARY"
if ! terraform apply -input=false -no-color "$tmpdir/maintenance.tfplan" > "$tmpdir/apply.log" 2>&1; then
  echo "Targeted Terraform apply failed; inspect AWS before retrying. Private diagnostics withheld." >&2; exit 1
fi
if [[ "$stack" == main ]]; then
  while IFS= read -r instance_id; do
    [[ -n "$instance_id" ]] || continue
    aws ec2 wait instance-terminated --instance-ids "$instance_id"
  done < "$tmpdir/nat-ids"
  while IFS= read -r volume_id; do
    [[ -n "$volume_id" ]] || continue
    remaining="$(aws ec2 describe-volumes --filters "Name=volume-id,Values=$volume_id" --query 'length(Volumes)' --output text)"
    [[ "$remaining" == 0 ]] || { echo "NAT root EBS still exists; follow-up required." >&2; exit 1; }
  done < "$tmpdir/root-volumes"
  echo "NAT root EBS deletion verified." >> "$GITHUB_STEP_SUMMARY"
fi
# Empty alarm lists are valid; every returned project alarm must be absent.
prefix=transitforge-dev-
if [[ "$stack" == data-builder ]]; then prefix=transitforge-dev-data-builder; fi
alarms="$(aws cloudwatch describe-alarms --alarm-name-prefix "$prefix" --query 'sum([length(MetricAlarms), length(CompositeAlarms)])' --output text)"
[[ "$alarms" == 0 ]] || { echo "Project alarms remain; follow-up required." >&2; exit 1; }
echo "Approved fixed-cost resource removal completed ($stack)." >> "$GITHUB_STEP_SUMMARY"
