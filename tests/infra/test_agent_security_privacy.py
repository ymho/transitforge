import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
AGENT_STREAM = (ROOT / "infra/terraform/environments/dev/agent-stream.tf").read_text()


class AgentSecurityPrivacyInfrastructureTest(unittest.TestCase):
    def test_personal_state_can_only_query_and_transactionally_delete_derived_trip_rows(self):
        self.assertIn(
            '{ Effect = "Allow", Action = ["dynamodb:Query", "dynamodb:TransactWriteItems"], Resource = aws_dynamodb_table.trips.arn }',
            AGENT_STREAM,
        )
        self.assertIn("TRIP_TABLE_NAME            = aws_dynamodb_table.trips.name", AGENT_STREAM)
        candidate_statement = AGENT_STREAM.split(
            "# Candidate sets/adoption previews are conversation-derived", 1
        )[1].split("] })", 1)[0]
        for forbidden in ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Scan"]:
            self.assertNotIn(forbidden, candidate_statement)

    def test_candidate_cleanup_does_not_expand_agent_model_role(self):
        personal_policy = AGENT_STREAM.split('resource "aws_iam_role_policy" "personal_state"', 1)[1].split(
            'resource "aws_lambda_function" "personal_state"', 1
        )[0]
        agent_policy = AGENT_STREAM.split('resource "aws_iam_role_policy" "agent_stream_logs"', 1)[1].split(
            'resource "aws_lambda_function" "agent_stream"', 1
        )[0]
        self.assertIn("aws_dynamodb_table.trips.arn", personal_policy)
        self.assertNotIn("TransactWriteItems", agent_policy)
        self.assertNotIn("dynamodb:Scan", personal_policy)


if __name__ == "__main__":
    unittest.main()
