"""Static security/package contracts. Does not deploy or claim to replace live IAM testing."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class RailImpactContractTest(unittest.TestCase):
    def test_subject_gsi_is_keys_only_and_not_granted_to_agent(self):
        tables = (ROOT / "infra/terraform/environments/dev/trips.tf").read_text()
        self.assertIn('name            = "rail-watch-routing"', tables)
        self.assertIn('hash_key        = "railSubject"', tables)
        block = tables.split('name            = "rail-watch-routing"')[1].split("}")[0]
        self.assertIn('projection_type = "KEYS_ONLY"', block)
        self.assertNotIn("rail-watch-routing", tables.split('data "aws_iam_policy_document"')[1])
        policy = (ROOT / "infra/terraform/environments/dev/rail-impact.tf").read_text()
        self.assertIn('/index/rail-watch-routing', policy)
        self.assertIn('dynamodb:EnclosingOperation', policy)
        self.assertIn('dynamodb:Attributes', policy)
        self.assertIn('"impact", "impactId"', policy)
        for forbidden in ['dynamodb:Scan', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'resources = ["*"]',
                          'bedrock:Invoke', 'sqs:SendMessage', 'aws_lambda_function_url', 'aws_apigatewayv2_route', 'schedule_expression']:
            self.assertNotIn(forbidden, policy)

    def test_public_agent_and_browser_cannot_route_or_invoke(self):
        entrypoint = (ROOT / "backend/agent-api/src/lambda.ts").read_text()
        for name in ["RailImpact", "rail-impact", "rail-watch-routing", "reconcile-watch"]:
            self.assertNotIn(name, entrypoint)
        for source in (ROOT / "frontend/src").rglob("*.ts"):
            self.assertNotIn("rail-watch-routing", source.read_text())
        router = (ROOT / "backend/agent-api/src/adapters/dynamodb-trip-impact-router.ts").read_text()
        self.assertIn('railSubject = :subject', router)
        self.assertIn('watches.read(principal, tripId)', router)
        self.assertNotIn("ScanCommand", router)
        app = (ROOT / "backend/agent-api/src/usecases/trip-impact-application.ts").read_text()
        self.assertIn("this.worker.process(principal", app)
        self.assertIn("railTravelEvent(...input)", app)
        self.assertNotIn("console.", app)

    def test_area_facts_reuse_internal_routing_and_store_without_new_scheduler(self):
        composition = (ROOT / "backend/agent-api/src/rail-impact-composition-root.ts").read_text()
        self.assertIn("DynamoDbTripImpactRepository", composition)
        self.assertIn("DeterministicTripImpactEvaluator", composition)
        application = (ROOT / "backend/agent-api/src/usecases/trip-impact-application.ts").read_text()
        self.assertIn("weatherTravelEvent(...input)", application)
        self.assertIn("hazardTravelEvent(...input)", application)
        for forbidden in ["ChecklistApplication", "Notification", "Feasibility", "setInterval", "ScheduleCommand"]:
            self.assertNotIn(forbidden, composition + application)
        entrypoint = (ROOT / "backend/agent-api/src/lambda.ts").read_text()
        self.assertNotIn("createInternalTripImpact", entrypoint)

    def test_separate_package_and_no_private_logs_or_notification_state(self):
        contract = json.loads((ROOT / "infra/packaging/rail-impact.json").read_text())
        self.assertEqual(contract["handler"], "index.handler")
        self.assertEqual(contract["files"], ["index.cjs"])
        scripts = json.loads((ROOT / "backend/agent-api/package.json").read_text())["scripts"]
        self.assertIn("bundle:rail-impact", scripts["build"])
        self.assertIn("src/rail-impact-lambda.ts", scripts["bundle:rail-impact"])
        adapter = (ROOT / "backend/agent-api/src/adapters/dynamodb-trip-impact-repository.ts").read_text()
        self.assertIn('archived = :active AND trip = :trip', adapter)
        self.assertIn('IMPACT#${tripId}', adapter)
        for forbidden in ["bookingReference", "notificationId", "deliveryStatus", "ScanCommand", "console."]:
            self.assertNotIn(forbidden, adapter)


if __name__ == "__main__":
    unittest.main()
