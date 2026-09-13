"""Static negative security contracts; no AWS credentials or resource mutation."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class TripStorageContractTest(unittest.TestCase):
    def test_private_owner_scoped_permissions(self):
        source = (ROOT / "infra/terraform/environments/dev/trips.tf").read_text()
        self.assertIn("resources = [aws_dynamodb_table.trips.arn]", source)
        for action in ["GetItem", "PutItem", "UpdateItem", "DeleteItem", "Query"]:
            self.assertIn(f'"dynamodb:{action}"', source)
        for forbidden in ['"dynamodb:Scan"', '"dynamodb:*"', 'resources = ["*"]', 'aws_lambda_function_url', 'aws_apigatewayv2_route']:
            self.assertNotIn(forbidden, source)
        self.assertIn('hash_key                    = "pk"', source)
        self.assertIn('range_key                   = "sk"', source)
        self.assertIn("deletion_protection_enabled = true", source)
        self.assertIn("point_in_time_recovery", source)

    def test_production_handler_has_no_trip_verifier_or_application(self):
        source = (ROOT / "backend/agent-api/src/lambda.ts").read_text()
        self.assertIn("const tripHandler = createTripApiHandler();", source)
        self.assertNotIn("createInternalTripApplication", source)
        self.assertNotIn("DynamoDbTripRepository", source)

    def test_reservations_remain_internal_owner_scoped_without_delete(self):
        entrypoint = (ROOT / "backend/agent-api/src/lambda.ts").read_text()
        self.assertNotIn("createInternalReservationApplication", entrypoint)
        self.assertNotIn("DynamoDbReservationRepository", entrypoint)
        adapter = (ROOT / "backend/agent-api/src/adapters/dynamodb-reservation-repository.ts").read_text()
        self.assertIn("OWNER#${principal.subject}", adapter)
        self.assertIn("RESERVATION#${tripId}", adapter)
        self.assertNotIn("ScanCommand", adapter)
        self.assertNotIn("DeleteItemCommand", adapter)
        self.assertNotIn("console.", adapter)
        self.assertIn("attribute_exists(pk) AND revision = :base", adapter)

    def test_checklist_is_independent_internal_and_uses_atomic_owner_cas(self):
        entrypoint = (ROOT / "backend/agent-api/src/lambda.ts").read_text()
        self.assertNotIn("createInternalChecklistApplication", entrypoint)
        self.assertNotIn("DynamoDbChecklistRepository", entrypoint)
        adapter = (ROOT / "backend/agent-api/src/adapters/dynamodb-checklist-repository.ts").read_text()
        for expected in ["OWNER#${principal.subject}", "CHECKLIST#${tripId}", "CHECKLIST_STATE#${tripId}",
                         "TransactWriteItemsCommand", "attribute_exists(pk) AND revision = :base"]:
            self.assertIn(expected, adapter)
        for forbidden in ["ScanCommand", "DeleteItemCommand", "console.", "TRIP#", "RESERVATION#"]:
            self.assertNotIn(forbidden, adapter)


if __name__ == "__main__":
    unittest.main()
