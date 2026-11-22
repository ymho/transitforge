"""Allow only removal of the reviewed, rebuildable dev resources. Never log values."""
import json
import re
import sys


MAIN = {
    "aws_eip.ai_egress",
    "aws_eip_association.ai_nat",
    "aws_instance.ai_nat",
    "aws_route.ai_egress_private_internet",
    "aws_ecs_service.otp",
    "aws_service_discovery_service.otp",
    "aws_service_discovery_private_dns_namespace.otp",
    *{
        "aws_cloudwatch_metric_alarm." + name
        for name in (
            "trip_changed_dlq", "trip_changed_lag", "trip_changed_heartbeat",
            "trip_changed_tick_dlq", "trip_recheck", "trip_recheck_heartbeat",
            "trip_recheck_tick_dlq", "notification", "notification_tick_dlq",
            "rail_impact_failure",
        )
    },
}
DATA_BUILDER = {
    "aws_cloudwatch_metric_alarm.scheduler_target_error",
    "aws_cloudwatch_metric_alarm.traffic_collector_error",
    "aws_cloudwatch_metric_alarm.traffic_scheduler_target_error",
}
STACKS = {"main": MAIN, "data-builder": DATA_BUILDER}
ADDRESS = re.compile(r'([a-z_]+\.[a-z_]+)(?:\[(?:0|"[A-Za-z0-9_-]+")\])?\Z')


def review(plan, stack):
    allowed = STACKS[stack]
    if (not isinstance(plan, dict) or not str(plan.get("format_version", "")).startswith("1.")
            or plan.get("errored") or not isinstance(plan.get("resource_changes"), list)):
        raise ValueError("A valid Terraform plan is required")
    if plan.get("variables", {}).get("hibernation_enabled", {}).get("value") not in (True, "true"):
        raise ValueError("The plan must keep hibernation enabled")
    # Targeted maintenance plans are intentionally incomplete. Review every action,
    # including dependency changes; never accept replacement/create/update/forget.
    summary = []
    for resource in plan["resource_changes"]:
        actions = resource.get("change", {}).get("actions")
        if resource.get("mode") == "data" and actions in (["read"], ["no-op"]):
            continue
        if resource.get("mode") != "managed":
            raise ValueError("Unexpected resource mode")
        if actions == ["no-op"]:
            continue
        match = ADDRESS.fullmatch(resource.get("address", ""))
        if not match or match[1] not in allowed or actions != ["delete"]:
            raise ValueError("Plan changes a resource outside the approved deletion list")
        if resource.get("type") != match[1].split(".")[0]:
            raise ValueError("Resource type does not match the approved address")
        before = resource.get("change", {}).get("before")
        if not isinstance(before, dict):
            raise ValueError("Deletion must refer to an existing resource")
        if resource["type"] == "aws_instance":
            tags = before.get("tags_all", {})
            if tags.get("Project") != "transitforge" or tags.get("Environment") != "dev":
                raise ValueError("NAT tags do not match the approved dev project")
        summary.append("delete " + resource["address"])
    return ["Approved targeted deletions: " + str(len(summary)), *sorted(summary)]


def main():
    try:
        mode, stack = sys.argv[1:]
        if mode == "targets":
            print("\n".join(sorted(STACKS[stack])))
        elif mode == "review":
            print("\n".join(review(json.load(sys.stdin), stack)))
        else:
            raise ValueError("Unsupported mode")
    except (KeyError, TypeError, ValueError):
        # Deliberately omit exception/input contents: plans can contain secrets.
        print("Hibernation deletion guard rejected the plan", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
