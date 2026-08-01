from __future__ import annotations

import importlib.util
import gzip
import io
import json
import sys
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
    sys.path.insert(0, str(path.parent))
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


class FakeS3:
    def __init__(self, value):
        self.value = value
        self.requests = []

    def get_object(self, **kwargs):
        self.requests.append(kwargs)
        payload = gzip.compress(json.dumps(self.value).encode("utf-8"), mtime=0)
        return {"Body": io.BytesIO(payload)}

    def head_object(self, **kwargs):
        return {"ETag": '"representative-v1"'}


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
                "query_daily_congestion_analysis",
                "search_train_arrivals",
                "search_representative_timetable",
                "query_train_delay_analysis",
                "focus_train",
                "set_weather",
                "set_layer_visibility",
            ],
        )

    def test_searches_a_private_representative_timetable(self) -> None:
        handler.representative_timetable._cache.clear()
        client = FakeS3({
            "schema_version": "ai-timetable-v1",
            "service_date": "2026-07-31",
            "timetable_kind": "weekday",
            "trains": [{
                "service_uid": "service-1",
                "train_no": "101M",
                "service_type": "特急",
                "train_name": "はるか16号",
                "origin_station": "関西空港",
                "destination_station": "京都",
                "stops": [
                    {"station_name": "大阪", "event": "着", "route_time_minutes": 600},
                    {"station_name": "大阪", "event": "発", "route_time_minutes": 602},
                ],
            }],
        })

        result = handler.representative_timetable.search(
            client,
            "private-bucket",
            "ai-timetable",
            {
                "timetableKind": "weekday",
                "query": "平日の10時ごろ大阪に着く特急",
                "mode": "arrivals",
                "targetTimeMinutes": 600,
            },
        )

        self.assertEqual(result["serviceDate"], "2026-07-31")
        self.assertEqual(result["totalMatchCount"], 1)
        self.assertEqual(result["matches"][0]["trainNumber"], "101M")
        self.assertEqual(
            client.requests[0]["Key"], "ai-timetable/weekday.json.gz"
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

    def test_builds_hourly_and_per_train_congestion_analysis(self) -> None:
        client = FakeDynamoDB(
            [
                dynamo_item(
                    "2026-07-29T07:00:00+00:00",
                    total=100,
                    train_totals={"100A": 60, "200B": 40},
                ),
                dynamo_item(
                    "2026-07-29T07:30:00+00:00",
                    total=200,
                    train_totals={"100A": 100, "200B": 100},
                ),
                dynamo_item(
                    "2026-07-29T08:15:00+00:00",
                    total=240,
                    train_totals={"100A": 80, "300C": 160},
                ),
            ]
        )

        result = handler.query_daily_congestion_analysis(
            client,
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 3)
        self.assertEqual(result["observationStart"], "2026-07-29T07:00:00+00:00")
        self.assertEqual(result["observationEnd"], "2026-07-29T08:15:00+00:00")
        self.assertEqual(
            result["hourly"][16],
            {
                "hourJst": 16,
                "sampleCount": 2,
                "averageTotalCongestion": 150,
                "peakTotalCongestion": 200,
                "peakCollectedAt": "2026-07-29T07:30:00+00:00",
                "averageTrainCount": 2,
                "topTrain": {
                    "trainNumber": "100A",
                    "observedSampleCount": 2,
                    "averageCongestion": 80,
                    "dailyAverageContribution": 80,
                    "peakCongestion": 100,
                    "peakCollectedAt": "2026-07-29T07:30:00+00:00",
                },
            },
        )
        self.assertEqual(result["hourly"][17]["averageTotalCongestion"], 240)
        self.assertEqual(
            result["trainStats"][0],
            {
                "trainNumber": "300C",
                "observedSampleCount": 1,
                "averageCongestion": 160,
                "dailyAverageContribution": 53.33,
                "peakCongestion": 160,
                "peakCollectedAt": "2026-07-29T08:15:00+00:00",
            },
        )

    def test_returns_empty_24_hour_analysis_when_a_day_has_no_samples(self) -> None:
        result = handler.query_daily_congestion_analysis(
            FakeDynamoDB([]),
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 0)
        self.assertIsNone(result["peak"])
        self.assertEqual(len(result["hourly"]), 24)
        self.assertTrue(all(hour["sampleCount"] == 0 for hour in result["hourly"]))
        self.assertEqual(result["trainStats"], [])

    def test_handles_an_observation_without_valid_train_congestion(self) -> None:
        result = handler.query_daily_congestion_analysis(
            FakeDynamoDB(
                [
                    dynamo_item(
                        "2026-07-29T08:15:00+00:00",
                        total=0,
                        train_totals={},
                    )
                ]
            ),
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 1)
        self.assertIsNone(result["hourly"][17]["topTrain"])
        self.assertEqual(result["trainStats"], [])

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

    def test_builds_latest_hourly_and_per_train_delay_analysis(self) -> None:
        client = FakeDynamoDB(
            [
                delay_dynamo_item(
                    "2026-07-29T07:00:00+00:00",
                    {"100A": 3, "200B": 8},
                ),
                delay_dynamo_item(
                    "2026-07-29T07:30:00+00:00",
                    {"100A": 5},
                ),
                delay_dynamo_item(
                    "2026-07-29T08:15:00+00:00",
                    {"300C": 12},
                    failures=1,
                ),
            ]
        )

        result = handler.query_train_delay_analysis(
            client,
            "delay-summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 3)
        self.assertEqual(result["latest"]["failureCount"], 1)
        self.assertEqual(result["latest"]["topTrains"][0], {
            "trainNumber": "300C",
            "delayMinutes": 12,
        })
        self.assertEqual(result["peak"]["delayedTrainCount"], 2)
        self.assertEqual(result["hourly"][16]["averageDelayedTrainCount"], 1.5)
        self.assertEqual(result["hourly"][16]["maximumDelayMinutes"], 8)
        self.assertEqual(result["hourly"][17]["peakTotalDelayMinutes"], 12)
        self.assertEqual(result["trainStats"][0]["trainNumber"], "300C")
        self.assertEqual(result["trainStats"][1]["delayedSampleCount"], 1)
        self.assertEqual(client.queries[0]["TableName"], "delay-summaries")

    def test_returns_unobserved_delay_hours_as_null(self) -> None:
        result = handler.query_train_delay_analysis(
            FakeDynamoDB([]),
            "delay-summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 0)
        self.assertIsNone(result["latest"])
        self.assertIsNone(result["peak"])
        self.assertEqual(len(result["hourly"]), 24)
        self.assertIsNone(result["hourly"][0]["averageDelayedTrainCount"])


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


def delay_dynamo_item(collected_at, train_delays, failures=0):
    return {
        "serviceDate": {"S": "2026-07-29"},
        "collectedAt": {"S": collected_at},
        "sourceCount": {"N": "25"},
        "failureCount": {"N": str(failures)},
        "observedTrainCount": {"N": "300"},
        "delayedTrainCount": {"N": str(len(train_delays))},
        "totalDelayMinutes": {"N": str(sum(train_delays.values()))},
        "maximumDelayMinutes": {"N": str(max(train_delays.values(), default=0))},
        "trainDelays": {
            "M": {
                train_number: {"N": str(delay)}
                for train_number, delay in train_delays.items()
            }
        },
    }


if __name__ == "__main__":
    unittest.main()
