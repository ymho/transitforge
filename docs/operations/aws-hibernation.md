# AWS dev environment hibernation (TransitForge / RAIQUORA)

Status: **hibernation requested on 2026-11-18**. AWS is only considered paused when the GitHub Actions run **AWS / Hibernate TransitForge** succeeds and AWS resources have been checked.

## Scope

- Target AWS region: `ap-northeast-1`. Authentication must use the existing `transitforge-dev-github-deploy` OIDC role in the protected GitHub `dev` environment.
- The workflow `.github/workflows/hibernate-aws.yml` runs after its first merge to `main`, or can be rerun manually. It executes `tools/deployment/hibernate-aws.sh`.
- Disable both CloudFront distributions (public site + API frontend). Do **not** delete distributions or their configurations.
- Disable EventBridge Scheduler jobs in TransitForge data-builder groups (daily build, promoter, once-per-minute traffic, optional knowledge/OTP graph jobs), plus the old scheduled EventBridge rules for TripChanged/recheck.
- Scale any `transitforge-dev-*` ECS services to desired count 0 and stop leftover running tasks.
- Stop only the project NAT EC2 instance identified using project/environment tags and its expected `transitforge-dev-<account>-ai-nat` instance profile. Keep EIP and EBS so the external-provider source IP can be reused.
- Disable CloudWatch alarm actions to suppress intentional polling-stop alerts.
- Automatic AWS deployments are blocked in both repositories during hibernation. TransitForge's `CD / Deploy` permits plan-only runs on `main` and data-builder's `deploy-dev` is disabled.

## Preserved intentionally

- GitHub repositories, branches and release history; Terraform source and remote S3 backend / state.
- S3 source timetables, route graph objects, website assets and long-term traffic archives.
- DynamoDB data, point-in-time recovery and deletion protection.
- Cognito user accounts, ECR images, Secrets Manager secrets, Lambda definitions, Bedrock Knowledge Base / S3 Vectors (if enabled), CloudFront configurations, certificates, DNS.

**A fully zero-cost environment is not guaranteed.** Retained EIP/public IPv4, EC2 EBS, S3/ECR storage, DynamoDB backups/PITR, S3 Vectors, Secrets Manager, and CloudWatch alarms may continue to incur charges. Releasing the EIP would lose the known fixed source IP; deleting stored data would defeat the purpose of reversible hibernation.

## Verify after running the pause workflow

1. GitHub Actions: `AWS / Hibernate TransitForge` must succeed. Read the job summary for changed counts. Failure implies **partial**, not successful, suspension.
2. AWS EventBridge Scheduler: check TransitForge groups and the `default` group, all applicable schedules DISABLED.
3. AWS EventBridge Rules: all TransitForge *scheduled* rules DISABLED.
4. AWS ECS: every TransitForge dev service has desired/running count 0, no stray Fargate tasks.
5. AWS EC2: the tagged NAT instance is stopped.
6. CloudFront: both distributions have `Enabled=false` and have reached `Deployed`.
7. AWS Cost Explorer: monitor by service for at least the following billing days (some data arrives late), and check for resources not managed by these two Terraform stacks.
8. Cloudflare, Mapbox and domain subscriptions are **outside AWS** and must be audited separately if desired.

## Resume

1. Confirm the saved datasets and GTFS validity: a pause can leave previously valid snapshots and bus feeds stale. Review current route graph before re-enabling endpoints.
2. In the TransitForge repository, remove the hibernation workflow or disable its push trigger. Do not rerun it after recovery.
3. Start the saved NAT instance in EC2 and check its original EIP remains associated and network egress works.
4. Restore the data-builder repo's `deploy-dev` job condition to the previous push-to-main expression. Merge it and confirm its Terraform apply has re-enabled daily, promoter and optional schedules.
5. Restore the TransitForge repo's `CD / Deploy` job condition to the prior workflow-run / manual-deploy logic. Run the deployment and its usual smoke tests. Terraform must reconcile the CloudFront `Enabled` drift and ECS `desired_count` drift. Verify that the CloudFront + route service are healthy before declaring restored.
6. Re-enable CloudWatch alarm actions for the project's alarms, verify no paused schedules remain, and inspect AWS Cost Explorer.

**Caution:** a manual `terraform apply` with the unmodified Terraform code while paused would re-enable services because the hibernation procedure deliberately changes the live AWS state without deleting Terraform resources. Keep the deployment gates blocked until restoration.

## What is not automated

Releasing the fixed EIP, deleting EBS, purging ECR/S3 or deleting user/backup/secret data. These can reduce costs further but are not treated as reversible, safe operations.
