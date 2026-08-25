from __future__ import annotations

import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location(
    "build_lambda_package", ROOT / "tools" / "build_lambda_package.py"
)
assert SPEC and SPEC.loader
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class LambdaPackagingTest(unittest.TestCase):
    def test_builds_only_declared_python_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "agent-api.zip"
            result = PACKAGE.build_package(ROOT, output)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()

        self.assertEqual(result["handler"], "handler.lambda_handler")
        self.assertIn("handler.py", names)
        self.assertTrue(all(name.endswith(".py") for name in names))
        self.assertFalse(any("__pycache__" in name for name in names))
        self.assertFalse(any(name.endswith(".pyc") for name in names))


if __name__ == "__main__":
    unittest.main()
