# AWS dev environment hibernation (TransitForge / RAIQUORA)

Both repositories record `hibernation_enabled=true` in `hibernation.auto.tfvars.json`.
Normal deployment jobs remain blocked. Merged code alone is not proof of a successful
AWS change: inspect the maintenance workflow and its resource readbacks.

## Scope and preserved data

- Tokyo region only, with the existing protected GitHub `dev` environment and each
  repository's dedicated OIDC deployment role. No permanent credentials are added.
- Keep both CloudFront distributions and all project scheduled work disabled, and
  all project ECS clusters without running tasks.
- Preserve S3 objects and source datasets, DynamoDB tables/PITR, Cognito accounts,
  ECR images, Secrets Manager values, Terraform remote state, Lambda definitions,
  optional Knowledge Base/S3 Vectors, certificates and domain configuration.
- Existing S3 lifecycle, DynamoDB TTL and log retention continue during suspension.
  Retention is not an indefinite snapshot of historical data.

## Remove rebuildable fixed-cost resources

The owner authorized releasing the fixed egress IP and deleting the NAT EC2 and
its bootstrap-only root EBS, the OTP service/private DNS, and project CloudWatch
alarm objects. Recovery with exactly the same IP is no longer required.

1. Merge the data-builder cost-reduction change first. Its `AWS / Reduce hibernation
   costs` workflow must succeed and confirm no data-builder alarms remain.
2. Merge the main cost-reduction change. The corresponding workflow runs once when
   its workflow file reaches `main`, or manually from `main` for an idempotent retry.
3. `tools/deployment/reduce-hibernation-costs.sh` verifies the region and dedicated role.
   The NAT must be stopped and correctly tagged, with exactly one root EBS mapping
   whose `DeleteOnTermination` is true. Additional disks stop the process before apply.
4. Terraform creates a targeted saved plan. `tools/deployment/hibernation-cost-plan.py`
   accepts only delete actions for an exact resource-address list. Any create, update,
   replacement, forget or unrelated deletion, including dependency changes, is rejected.
   Resource actions alone enter the summary; raw plan/state/secret values are withheld.
5. Apply that exact saved plan. Wait for NAT termination and verify its original root
   EBS is gone. The main `verify-hibernation.sh` checks disabled CloudFront/schedules,
   zero tasks, no NAT/EIP/OTP private DNS and no project alarm objects.

This is deliberately targeted maintenance, not a whole-stack destroy or application
redeployment. Persistent data and credentials are not targets. Both stacks also have
Terraform hibernation gates so a future full apply does not recreate these cost resources
or re-enable serving/polling. The normal deployment safety guard remains strict.

No images, graph objects, website builds, raw inputs or logs are purged here. Consider
those only after checking exact regeneration inputs and pinned dependencies. Historical
GTFS/OSM/timetable inputs may not be downloadable again; preserve sources and manifests.

## Remaining costs and verification

Storage remains chargeable in S3/ECR/logs and optional S3 Vectors. DynamoDB storage,
PITR/backups and Secrets Manager may also be billed. Shortening PITR recovery days
alone does not reduce its size-based charge.

Inspect Cost Explorer by service and usage type for complete days after suspension;
recheck after billing updates. Include other Regions, experimental/unmanaged resources,
commitments and subscriptions. The existing verifier is scoped to this named project
in Tokyo and does not establish account-wide zero billing. Match Fargate Health affected
resource/task IDs to ECS status; email receipt alone does not establish current usage.
Cloudflare, Mapbox and domain subscriptions are outside this AWS maintenance.

## Resume

1. Disable/remove the cost-reduction workflow push triggers in both repositories and
   the original hibernation workflow push trigger before any recovery apply.
2. Set `hibernation_enabled=false` in both versioned hibernation settings. Retain the
   `moved` blocks, which preserve resource identities across the indexed-address change.
3. Use a reviewed recovery plan to recreate NAT/EBS and allocate a new EIP. The old
   IP is not guaranteed recoverable. Check external-provider allowlists, update their
   registrations as necessary, and verify HTTPS egress.
4. Recreate OTP DNS/service and alarm objects through Terraform. Protected recovery
   resource changes require a separately reviewed recovery path: do not bypass the
   ordinary deployment guard by running an old deployment revision.
5. Review GTFS validity, saved source datasets, pinned images and graph hashes. Build
   fresh derived data where necessary before re-enabling endpoints. Graphs were retained.
6. Restore the data-builder deployment condition, then the main CD condition and normal
   smoke tests as part of the reviewed recovery. Re-enable manual OTP graph building and
   paid live evaluation only when explicitly needed.
7. Confirm serving, authenticated operations, monitoring, provider connectivity and billing.
