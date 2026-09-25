"""Static contracts for the dedicated authenticated Trip public writer."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class TripPublicWriterContractTest(unittest.TestCase):
    def test_dedicated_lambda_has_only_trip_route_and_minimum_permissions(self):
        source = (ROOT / "infra/terraform/environments/dev/agent-stream.tf").read_text()
        for required in [
            'resource "aws_lambda_function" "trip_api"',
            'resource "aws_api_gateway_method" "trip_api_post"',
            'path_part   = "trips"',
            'path_part   = "v1"',
            'source_arn    = "${aws_api_gateway_rest_api.agent_stream[each.key].execution_arn}/${var.environment}/POST/api/trips/v1"',
            'TRIP_API_ENABLED        = "true"',
            'SERVER_STATE_TABLE_NAME = aws_dynamodb_table.server_state.name',
            'aws_dynamodb_table.trips.arn',
            '"${aws_dynamodb_table.trips.arn}/index/trip-sharing"',
            '"dynamodb:TransactWriteItems"',
            '"dynamodb:ConditionCheckItem"',
            '["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:TransactWriteItems"], Resource = aws_dynamodb_table.server_state.arn',
        ]:
            self.assertIn(required, source)
        role = source.split('resource "aws_iam_role_policy" "trip_api"')[1].split('resource "aws_lambda_function" "trip_api"')[0]
        for forbidden in ['"dynamodb:Scan"', '"dynamodb:*"', 'resources = ["*"]', 'bedrock:', 'vpc_config']:
            self.assertNotIn(forbidden, role)

    def test_public_entrypoint_does_not_expose_other_trip_features(self):
        source = (ROOT / "backend/agent-api/src/trip-api-composition.ts").read_text()
        self.assertIn('"/api/trips/v1"', source)
        self.assertIn('const applications = createAuthorizedTripApplications(options.tripTable, options.stateTable)', source)
        self.assertIn('if (!options.tripTable || !options.stateTable)', source)
        self.assertIn('new DynamoDbItineraryCandidateRepository(options.tripTable)', source)
        self.assertIn('new PlanCandidateAdoptionApplication(', source)
        self.assertIn('executeAdoption: adoption.execute.bind(adoption)', source)
        for forbidden in ['sharing.', 'notification', 'in-trip', 'createPersonalApiHandler',
                          'createInternalReservationApplication', 'createInternalChecklistApplication']:
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
