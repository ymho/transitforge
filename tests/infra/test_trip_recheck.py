"""Shared recheck runtime, packaging and privilege regression contracts; no live AWS calls."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parents[2]


class TripRecheckInfraTest(unittest.TestCase):
    def test_single_shared_tick_bounded_due_index_and_recovery(self):
        text = (ROOT / "infra/terraform/environments/dev/trip-recheck.tf").read_text()
        self.assertEqual(text.count('schedule_expression = "rate(1 minute)"'), 1)
        for token in ["recheck-due", '"KEYS_ONLY"', "point_in_time_recovery", "server_side_encryption",
                      "maximum_retry_attempts", "maximum_event_age_in_seconds", "aws_sqs_queue",
                      "aws_lambda_function_event_invoke_config", "ArnEquals", "aws:SourceArn",
                      "RecheckLagMs", "PollSuccess", "DLQ", "ApproximateNumberOfMessagesVisible"]:
            self.assertIn(token, text)
        for token in ["aws_scheduler_schedule", "aws_lambda_function_url", "aws_apigatewayv2_route", "dynamodb:Scan",
                      "dynamodb:DeleteItem", "dynamodb:UpdateItem", "dynamodb:*", 'resources = ["*"]', "bedrock:",
                      "secretsmanager:", "sns:Publish"]:
            self.assertNotIn(token, text)

    def test_separate_table_has_no_agent_grant_or_public_handler(self):
        text = (ROOT / "infra/terraform/environments/dev/trip-recheck.tf").read_text()
        self.assertNotIn("aws_iam_role.bedrock_agent", text)
        for name in ["lambda.ts", "composition-root.ts"]:
            public = (ROOT / "backend/agent-api/src" / name).read_text()
            self.assertNotIn("Recheck", public)
            self.assertNotIn("recheck-task", public)
        app = (ROOT / "backend/agent-api/src/usecases/trip-recheck-application.ts").read_text()
        self.assertNotIn("console.", app)
        self.assertNotIn("savePush", app)
        self.assertNotIn("trips.save", app)
        self.assertIn("latest.revision !== task.sourceTripRevision", app)

    def test_existing_sources_and_impact_are_reused(self):
        root = ROOT / "backend/agent-api/src"
        source = (root / "adapters/provider-recheck-source.ts").read_text()
        for token in ["weatherTravelEvent", "hazardTravelEvent", "recheckForecastRanges"]:
            self.assertIn(token, source)
        collector = (root / "adapters/collector-recheck-source.ts").read_text()
        self.assertIn("loadRealtimeSnapshot", collector)
        self.assertIn("railTravelEvent", collector)
        self.assertNotIn("fetch(", collector)
        self.assertIn("createInternalTripImpact", (root / "trip-recheck-composition-root.ts").read_text())
        changed = (root / "trip-changed-lambda.ts").read_text()
        self.assertIn("createRecheckProjection", changed)

    def test_bundle(self):
        manifest = json.loads((ROOT / "infra/packaging/trip-recheck.json").read_text())
        self.assertEqual(manifest["files"], ["index.cjs"])
        self.assertEqual(manifest["runtime"], "nodejs22.x")
        self.assertEqual(manifest["handler"], "index.handler")
        bundle = ROOT / manifest["source"] / "index.cjs"
        self.assertTrue(bundle.is_file())
        self.assertLess(bundle.stat().st_size, 20 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
