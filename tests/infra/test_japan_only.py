import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "infra/terraform/environments/dev/cloudfront-japan-only.js"


def invoke(headers):
    request = {"uri": "/api/agent-stream", "method": "POST", "headers": headers}
    code = SOURCE.read_text() + "\nconsole.log(JSON.stringify(handler(" + json.dumps({"request": request}) + ")));"
    return json.loads(subprocess.run(["node", "-e", code], check=True, capture_output=True, text=True).stdout)


class JapanOnlyTest(unittest.TestCase):
    def test_allows_only_unambiguous_japanese_country_header(self):
        self.assertEqual(invoke({"cf-ipcountry": {"value": "JP"}})["uri"], "/api/agent-stream")
        for headers in [{}, {"cf-ipcountry": {"value": "US"}}, {"cf-ipcountry": {"value": "XX"}},
                        {"cf-ipcountry": {"value": "T1"}}, {"cf-ipcountry": {"value": "JP,US"}},
                        {"cf-ipcountry": {"value": "JP", "multiValue": [{"value": "JP"}, {"value": "US"}]}}]:
            result = invoke(headers)
            self.assertEqual(result["statusCode"], 403)
            self.assertEqual(result["headers"]["cache-control"]["value"], "private, no-store")


if __name__ == "__main__":
    unittest.main()
