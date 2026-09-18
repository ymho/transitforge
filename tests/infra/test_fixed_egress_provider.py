"""Offline boundary/IAM regression checks; never use AWS credentials or Terraform plan."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parents[2]
DEV = ROOT / "infra/terraform/environments/dev"


class FixedEgressProviderTest(unittest.TestCase):
    def test_default_off_private_boundary_reuses_egress(self):
        text = (DEV / "fixed-egress-provider.tf").read_text()
        self.assertIn("default     = false", text)
        self.assertIn("default     = null", text)
        self.assertIn("subnet_ids         = [aws_subnet.ai_egress_private.id]", text)
        self.assertIn("security_group_ids = [aws_security_group.ai_lambda.id]", text)
        for resource in ["aws_vpc", "aws_subnet", "aws_eip", "aws_instance", "aws_nat_gateway",
                         "aws_lambda_function_url", "aws_lambda_permission", "aws_apigatewayv2_route"]:
            self.assertNotIn(f'resource "{resource}"', text)
        egress = (DEV / "ai-egress.tf").read_text()
        self.assertIn('resource "aws_eip" "ai_egress"', egress)
        self.assertIn("allocation_id = aws_eip.ai_egress.id", egress)
        self.assertIn("network_interface_id   = aws_instance.ai_nat.primary_network_interface_id", egress)
        sg = egress.split('resource "aws_security_group" "ai_lambda"')[1].split('resource "')[0]
        self.assertNotIn("ingress {", sg)
        self.assertIn("from_port   = 443", sg)
        self.assertIn("to_port     = 443", sg)

    def test_caller_and_credentials_are_separate(self):
        text = (DEV / "fixed-egress-provider.tf").read_text()
        caller = text.split('data "aws_iam_policy_document" "invoke_fixed_egress_provider"')[1]
        self.assertIn('["lambda:InvokeFunction"]', caller)
        self.assertIn("resources = [aws_lambda_function.fixed_egress_provider[0].arn]", caller)
        self.assertNotIn("secretsmanager", caller)
        self.assertNotIn('resources = ["*"]', caller)
        self.assertIn("resources = [aws_secretsmanager_secret.fixed_egress_travel_provider[0].arn]", text)
        for action in ["bedrock:", "dynamodb:", "s3:", "cognito:"]:
            self.assertNotIn(action, text)
        self.assertNotIn("aws_iam_role.bedrock_agent", text)
        composition = (ROOT / "backend/agent-api/src/composition/fixed-egress-accommodation.ts").read_text()
        self.assertNotIn("SecretsManager", composition)
        self.assertNotIn("HttpAccommodationProvider", composition)

    def test_bounded_timeouts_and_package(self):
        self.assertIn("timeout          = 25", (DEV / "fixed-egress-provider.tf").read_text())
        manifest = json.loads((ROOT / "infra/packaging/fixed-egress-provider.json").read_text())
        self.assertEqual(manifest["runtime"], "nodejs22.x")
        self.assertEqual(manifest["handler"], "index.handler")
        self.assertEqual(manifest["files"], ["index.cjs"])
        bundle = ROOT / manifest["source"] / "index.cjs"
        self.assertGreater(bundle.stat().st_size, 0)
        self.assertLess(bundle.stat().st_size, 20 * 1024 * 1024)
        source = bundle.read_text()
        self.assertNotIn("BedrockRuntimeClient", source)
        self.assertNotIn("CognitoJwtVerifier", source)


if __name__ == "__main__":
    unittest.main()
