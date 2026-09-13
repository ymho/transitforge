"""Internal delivery / privacy / packaging contracts. No AWS calls."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parents[2]


class TripChangedInfraTest(unittest.TestCase):
    def test_private_worker_schedule_retry_dlq_and_alarms(self):
        source = (ROOT / "infra/terraform/environments/dev/trip-changed.tf").read_text()
        for required in ["aws_cloudwatch_event_target", "rate(1 minute)", "maximum_retry_attempts", "maximum_event_age_in_seconds",
                         "aws_sqs_queue", "sqs_managed_sse_enabled", "aws_lambda_function_event_invoke_config", "on_failure",
                         "ArnEquals", "aws:SourceArn", "ProjectionLagMs", "PollSuccess", '"DLQ"', "ApproximateNumberOfMessagesVisible",
                         "index/trip-changed-due", "dynamodb:ConditionCheckItem"]:
            self.assertIn(required, source)
        for forbidden in ["aws_lambda_function_url", "aws_apigatewayv2_route", "dynamodb:Scan", "dynamodb:DeleteItem",
                          "dynamodb:UpdateItem", "dynamodb:*", 'resources = ["*"]', "bedrock:", "secretsmanager:", "index/watch-subject"]:
            self.assertNotIn(forbidden, source)

    def test_durable_outbox_index_and_atomic_storage(self):
        source = (ROOT / "infra/terraform/environments/dev/trips.tf").read_text()
        self.assertIn('name            = "trip-changed-due"', source)
        self.assertIn('hash_key        = "outboxShard"', source)
        self.assertIn('range_key       = "availableAt"', source)
        self.assertIn('projection_type = "KEYS_ONLY"', source)
        repository = (ROOT / "backend/agent-api/src/adapters/dynamodb-trip-repository.ts").read_text()
        self.assertEqual(repository.count("tripChangedPut(this.table"), 3)
        self.assertEqual(repository.count("new TransactWriteItemsCommand"), 3)
        for forbidden in ["SendMessage", "EventBridge", "console."]:
            self.assertNotIn(forbidden, repository)
        entrypoint = (ROOT / "backend/agent-api/src/lambda.ts").read_text()
        self.assertNotIn("TripChanged", entrypoint)
        self.assertNotIn("reconcile-watch", entrypoint)

    def test_separate_bundled_worker_without_agent_configuration(self):
        manifest = json.loads((ROOT / "infra/packaging/trip-changed.json").read_text())
        self.assertEqual(manifest["files"], ["index.cjs"])
        self.assertEqual(manifest["runtime"], "nodejs22.x")
        self.assertEqual(manifest["handler"], "index.handler")
        bundle = ROOT / manifest["source"] / "index.cjs"
        self.assertTrue(bundle.is_file())
        self.assertLess(bundle.stat().st_size, 20 * 1024 * 1024)
        source = (ROOT / "backend/agent-api/src/trip-changed-lambda.ts").read_text()
        self.assertIn("TripWatchApplication", source)
        self.assertIn("trustedTick", source)
        self.assertNotIn("TripWatchWorker", source)
        self.assertNotIn("Reservation", source)
        self.assertNotIn("console.error", source)


if __name__ == "__main__":
    unittest.main()
