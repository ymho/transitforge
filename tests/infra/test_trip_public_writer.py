"""Static contracts for the dedicated authenticated Trip public writer."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class TripPublicWriterContractTest(unittest.TestCase):
    def test_dedicated_lambda_has_trip_and_sharing_routes_and_minimum_permissions(self):
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
            self.assertRegex(source, re.escape(required).replace(r'\ ', r'\s+'))
        role = source.split('resource "aws_iam_role_policy" "trip_api"')[1].split('resource "aws_lambda_function" "trip_api"')[0]
        self.assertIn('Action = ["bedrock:InvokeModel"]', role)
        self.assertIn('local.bedrock_foundation_model_ids', role)
        self.assertNotIn('"bedrock:*"', role)
        for forbidden in ['"dynamodb:Scan"', '"dynamodb:*"', 'resources = ["*"]', 'vpc_config']:
            self.assertNotIn(forbidden, role)

    def test_public_entrypoint_exposes_authenticated_sharing_without_internal_features(self):
        source = (ROOT / "backend/agent-api/src/trip-api-composition.ts").read_text()
        self.assertIn('"/api/trips/v1"', source)
        self.assertIn('const applications = createAuthorizedTripApplications(options.tripTable, options.stateTable)', source)
        self.assertIn('if (!options.tripTable || !options.stateTable)', source)
        self.assertIn('new DynamoDbItineraryCandidateRepository(options.tripTable)', source)
        self.assertIn('new PlanCandidateAdoptionApplication(', source)
        self.assertIn('executeAdoption: adoption.execute.bind(adoption)', source)
        self.assertIn('"/api/trips/sharing/v1"', source)
        self.assertIn('createTripSharingHandler', source)
        infra = (ROOT / "infra/terraform/environments/dev/agent-stream.tf").read_text()
        for required in ['"trip_sharing_post"', '"trip_sharing_v1"', '"trip_sharing"', 'OFFICIAL_PUBLISHER_SUBJECTS', 'api/trips/sharing/v1/POST']:
            self.assertIn(required, infra)
        sharing_method = infra.split('resource "aws_api_gateway_method" "trip_sharing_post"')[1].split('resource "aws_api_gateway_integration"')[0]
        self.assertRegex(sharing_method, r'authorization\s*=\s*"COGNITO_USER_POOLS"')
        self.assertIn('authorization_scopes', sharing_method)
        for forbidden in ['notification' , 'in-trip', 'createPersonalApiHandler',
                          'createInternalReservationApplication', 'createInternalChecklistApplication']:
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
