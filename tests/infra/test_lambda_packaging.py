from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
class LambdaPackagingTest(unittest.TestCase):
    def test_declares_only_the_bundled_node_handler(self) -> None:
        manifest = json.loads(
            (ROOT / "infra" / "packaging" / "agent-api.json").read_text(encoding="utf-8")
        )
        bundle = ROOT / manifest["source"] / manifest["files"][0]

        self.assertEqual(manifest["runtime"], "nodejs22.x")
        self.assertEqual(manifest["handler"], "index.handler")
        self.assertEqual(manifest["files"], ["index.cjs"])
        self.assertTrue(bundle.is_file())
        self.assertLess(bundle.stat().st_size, 20 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
