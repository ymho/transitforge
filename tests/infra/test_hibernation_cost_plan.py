import importlib.util
import unittest
from pathlib import Path


path = Path(__file__).resolve().parents[2] / "tools/deployment/hibernation-cost-plan.py"
spec = importlib.util.spec_from_file_location("hibernation_cost_plan", path)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def plan(address="aws_eip.ai_egress[0]", actions=None):
    return {
        "format_version": "1.2",
        "complete": False,
        "variables": {"hibernation_enabled": {"value": True}},
        "resource_changes": [{
            "address": address, "type": address.split(".")[0], "mode": "managed",
            "change": {"actions": actions or ["delete"], "before": {}, "after": None},
        }],
    }


class HibernationDeletionGuardTest(unittest.TestCase):
    def test_accepts_only_reviewed_rebuildable_deletions(self):
        self.assertIn("delete aws_eip.ai_egress[0]", guard.review(plan(), "main"))
        self.assertEqual(len(guard.review(plan('aws_cloudwatch_metric_alarm.traffic_collector_error["delay"]'), "data-builder")), 2)

    def test_rejects_data_secret_identity_and_unrelated_resource_deletions(self):
        for address in ["aws_s3_bucket.website", "aws_dynamodb_table.trips", "aws_secretsmanager_secret.travel_provider", "aws_cognito_user_pool.users", "aws_eip.other", "aws_ecs_cluster.otp"]:
            with self.subTest(address=address), self.assertRaises(ValueError):
                guard.review(plan(address), "main")

    def test_rejects_recreation_replacement_update_and_forget(self):
        for actions in [["create"], ["create", "delete"], ["delete", "create"], ["update"], ["forget"]]:
            with self.subTest(actions=actions), self.assertRaises(ValueError):
                guard.review(plan(actions=actions), "main")

    def test_rejects_dependency_updates_even_outside_explicit_targets(self):
        with self.assertRaises(ValueError):
            guard.review(plan('aws_lambda_function.agent_stream["stream"]', ["update"]), "main")

    def test_checks_hibernation_and_nat_ownership(self):
        p = plan(); p["variables"]["hibernation_enabled"]["value"] = False
        with self.assertRaises(ValueError): guard.review(p, "main")
        p = plan("aws_instance.ai_nat[0]")
        with self.assertRaises(ValueError): guard.review(p, "main")
        p["resource_changes"][0]["change"]["before"]["tags_all"] = {"Project": "transitforge", "Environment": "dev"}
        self.assertEqual(len(guard.review(p, "main")), 2)

    def test_rejects_cross_stack_and_malformed_plans(self):
        with self.assertRaises(ValueError): guard.review(plan(), "data-builder")
        with self.assertRaises(ValueError): guard.review({}, "main")


if __name__ == "__main__":
    unittest.main()
