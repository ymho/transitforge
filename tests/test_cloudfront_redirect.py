import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = (
    ROOT
    / "infra"
    / "terraform"
    / "environments"
    / "dev"
    / "cloudfront-redirect.js.tftpl"
)


def invoke_handler(request: dict) -> dict:
    source = TEMPLATE.read_text(encoding="utf-8").replace(
        "${target_hostname}", "app.ohmyki.com"
    )
    script = source + "\nconsole.log(JSON.stringify(handler({request: " + json.dumps(request) + "})));"
    completed = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


class CloudFrontRedirectTest(unittest.TestCase):
    def test_redirects_path_to_canonical_hostname(self) -> None:
        response = invoke_handler({"uri": "/trains/123", "querystring": {}})

        self.assertEqual(response["statusCode"], 308)
        self.assertEqual(
            response["headers"]["location"]["value"],
            "https://app.ohmyki.com/trains/123",
        )

    def test_preserves_and_encodes_query_parameters(self) -> None:
        response = invoke_handler(
            {
                "uri": "/search",
                "querystring": {
                    "station": {"value": "京都"},
                    "line": {
                        "value": "ignored when multiValue exists",
                        "multiValue": [{"value": "A B"}, {"value": "琵琶湖"}],
                    },
                },
            }
        )

        self.assertEqual(
            response["headers"]["location"]["value"],
            "https://app.ohmyki.com/search?line=A%20B&line=%E7%90%B5%E7%90%B6%E6%B9%96&station=%E4%BA%AC%E9%83%BD",
        )


if __name__ == "__main__":
    unittest.main()
