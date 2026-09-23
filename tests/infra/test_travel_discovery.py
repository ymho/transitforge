"""Static contracts for default-off Bedrock travel discovery infrastructure."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class TravelDiscoveryInfrastructureTest(unittest.TestCase):
    def test_retrieve_is_scoped_and_rerank_permissions_are_gated(self):
        source = (ROOT / "infra/terraform/environments/dev/agent-stream.tf").read_text()
        self.assertIn('Action = ["bedrock:Retrieve"]', source)
        self.assertIn('knowledge-base/${var.travel_knowledge_base_id}', source)
        self.assertNotIn('Action = ["bedrock:Retrieve"], Resource = "*"', source)
        self.assertIn('var.bedrock_rerank_model_arn == "" ? []', source)
        self.assertIn('Action = ["bedrock:Rerank"], Resource = "*"', source)
        self.assertIn('[var.bedrock_rerank_model_arn]', source)

    def test_knowledge_and_rerank_configuration_is_default_off(self):
        source = (ROOT / "infra/terraform/environments/dev/variables.tf").read_text()
        for name in ["travel_knowledge_base_id", "bedrock_rerank_model_arn"]:
            start = source.index(f'variable "{name}"')
            block = source[start:source.index("\n}", start) + 2]
            self.assertIn('default     = ""', block)

    def test_ingestion_manifest_forbids_personal_data(self):
        schema = json.loads((ROOT / "docs/data/travel-knowledge-manifest.schema.json").read_text())
        document = schema["properties"]["documents"]["items"]
        self.assertIn("containsPersonalData", document["required"])
        self.assertEqual(document["properties"]["containsPersonalData"], {"const": False})


if __name__ == "__main__":
    unittest.main()
