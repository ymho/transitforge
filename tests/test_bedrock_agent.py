from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from typing import Any


def load_handler():
    path = (
        Path(__file__).parents[1]
        / "infra"
        / "lambda"
        / "bedrock_agent"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location("bedrock_agent_handler", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


handler = load_handler()


class FakeBedrock:
    def __init__(self) -> None:
        self.request: dict[str, Any] | None = None

    def converse(self, **request: Any) -> dict[str, Any]:
        self.request = request
        return {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [{"text": "表示時刻を変更しました。"}],
                }
            },
            "stopReason": "end_turn",
        }


class BedrockAgentTest(unittest.TestCase):
    def test_accepts_a_user_message_and_uses_the_configured_tools(self) -> None:
        client = FakeBedrock()
        messages = handler.request_messages(
            {
                "requestContext": {"http": {"method": "POST"}},
                "body": json.dumps(
                    {
                        "messages": [
                            {
                                "role": "user",
                                "content": [{"text": "18時30分にして"}],
                            }
                        ]
                    }
                ),
            }
        )

        result = handler.converse(client, messages)

        self.assertEqual(result["stopReason"], "end_turn")
        assert client.request
        self.assertEqual(client.request["modelId"], handler.MODEL_ID)
        self.assertEqual(
            [
                item["toolSpec"]["name"]
                for item in client.request["toolConfig"]["tools"]
            ],
            ["set_display_time", "search_trains", "focus_train"],
        )

    def test_accepts_only_the_tool_conversation_blocks_we_relay(self) -> None:
        messages = handler.request_messages(
            {
                "requestContext": {"http": {"method": "POST"}},
                "body": json.dumps(
                    {
                        "messages": [
                            {
                                "role": "assistant",
                                "content": [
                                    {"text": "列車を検索します。"},
                                    {
                                        "toolUse": {
                                            "toolUseId": "tool-1",
                                            "name": "search_trains",
                                            "input": {"query": "京都行き"},
                                        }
                                    }
                                ],
                            },
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "toolResult": {
                                            "toolUseId": "tool-1",
                                            "status": "success",
                                            "content": [{"json": {"matches": []}}],
                                        }
                                    }
                                ],
                            },
                        ]
                    }
                ),
            }
        )

        self.assertEqual(len(messages), 2)
        self.assertEqual(
            messages[0]["content"][0],
            {"text": "列車を検索します。"},
        )

    def test_rejects_unknown_tools_and_oversized_prompts(self) -> None:
        for body in (
            {
                "messages": [
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "toolUse": {
                                    "toolUseId": "tool-1",
                                    "name": "delete_train",
                                    "input": {},
                                }
                            }
                        ],
                    }
                ]
            },
            {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": "a" * 4_001}],
                    }
                ]
            },
        ):
            with self.subTest(body=body):
                with self.assertRaises(handler.RequestError):
                    handler.request_messages(
                        {
                            "requestContext": {"http": {"method": "POST"}},
                            "body": json.dumps(body),
                        }
                    )

    def test_returns_a_no_store_error_for_non_post_requests(self) -> None:
        result = handler.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}},
            None,
        )

        self.assertEqual(result["statusCode"], 405)
        self.assertEqual(result["headers"]["cache-control"], "no-store")


if __name__ == "__main__":
    unittest.main()
