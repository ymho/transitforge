from __future__ import annotations

import importlib.util
import json
import unittest
from decimal import Decimal
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


class FakeDynamoDB:
    def __init__(self, items):
        self.items = items
        self.queries = []

    def query(self, **kwargs):
        self.queries.append(kwargs)
        return {"Items": self.items}


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
            [
                "set_display_time",
                "search_trains",
                "query_daily_congestion_peak",
                "focus_train",
                "set_weather",
                "set_scene_mode",
                "set_layer_visibility",
            ],
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

    def test_finds_the_peak_observation_and_top_trains_for_a_day(self) -> None:
        client = FakeDynamoDB(
            [
                dynamo_item(
                    "2026-07-29T00:00:00+00:00",
                    total=100,
                    train_totals={"100A": 60, "200B": 40},
                ),
                dynamo_item(
                    "2026-07-29T08:15:00+00:00",
                    total=240,
                    train_totals={"100A": 80, "300C": 160},
                ),
            ]
        )

        result = handler.query_daily_congestion_peak(
            client,
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 2)
        self.assertEqual(result["peak"]["totalCongestion"], 240)
        self.assertEqual(
            result["peak"]["topTrains"],
            [
                {"trainNumber": "300C", "totalCongestion": 160},
                {"trainNumber": "100A", "totalCongestion": 80},
            ],
        )
        self.assertEqual(client.queries[0]["TableName"], "summaries")

    def test_returns_no_peak_when_a_day_has_no_samples(self) -> None:
        result = handler.query_daily_congestion_peak(
            FakeDynamoDB([]),
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(
            result,
            {"serviceDate": "2026-07-29", "sampleCount": 0, "peak": None},
        )


def dynamo_item(collected_at, total, train_totals):
    return {
        "serviceDate": {"S": "2026-07-29"},
        "collectedAt": {"S": collected_at},
        "sourceUpdatedAt": {"S": collected_at},
        "totalCongestion": {"N": str(Decimal(total))},
        "trainCount": {"N": str(len(train_totals))},
        "carCount": {"N": "12"},
        "trainTotals": {
            "M": {
                train_number: {"N": str(Decimal(value))}
                for train_number, value in train_totals.items()
            }
        },
    }


if __name__ == "__main__":
    unittest.main()
