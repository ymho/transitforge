import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
STREAM_TERRAFORM = ROOT / "infra" / "terraform" / "environments" / "dev" / "agent-stream.tf"


class ApiGatewayLogsRoleTest(unittest.TestCase):
    def test_uses_api_gateway_trust_and_aws_managed_logs_policy(self) -> None:
        source = STREAM_TERRAFORM.read_text()

        role = re.search(
            r'resource "aws_iam_role" "agent_stream_gateway_logs"(.*?)\n\}\nresource ',
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(role)
        self.assertIn('Service = "apigateway.amazonaws.com"', role.group(1))

        attachment = re.search(
            r'resource "aws_iam_role_policy_attachment" "agent_stream_gateway_logs".*?policy_arn = "([^"]+)"',
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(attachment)
        self.assertEqual(
            attachment.group(1),
            "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
        )

        inline_policy = re.search(
            r'resource "aws_iam_role_policy" "agent_stream_gateway_logs"(.*?)\n\}\nresource ',
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(inline_policy)
        self.assertIn('"logs:DescribeLogGroups"', inline_policy.group(1))
        self.assertIn('"logs:CreateLogStream"', inline_policy.group(1))


if __name__ == "__main__":
    unittest.main()
