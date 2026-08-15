from __future__ import annotations

import importlib.util
import gzip
import io
import json
import sys
import unittest
from datetime import datetime, timezone
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
        service_date = kwargs["ExpressionAttributeValues"][":service_date"]["S"]
        return {
            "Items": [
                item
                for item in self.items
                if item.get("serviceDate", {}).get("S") == service_date
            ]
        }


class FakeS3:
    def __init__(self, value, snapshot=None):
        self.value = value
        self.snapshot = snapshot
        self.requests = []

    def get_object(self, **kwargs):
        self.requests.append(kwargs)
        if kwargs["Key"] == "api/traffic/delays.json":
            if self.snapshot is None:
                raise FileNotFoundError(kwargs["Key"])
            return {
                "Body": io.BytesIO(json.dumps(self.snapshot).encode("utf-8"))
            }
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
                "search_direct_routes",
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

    def test_queries_delays_from_4am_through_359am_as_one_operating_day(self) -> None:
        client = FakeDynamoDB(
            [
                delay_dynamo_item(
                    "2026-07-28T18:59:59+00:00",
                    {"before": 1},
                    service_date="2026-07-29",
                ),
                delay_dynamo_item(
                    "2026-07-28T19:00:00+00:00",
                    {"start": 2},
                    service_date="2026-07-29",
                ),
                delay_dynamo_item(
                    "2026-07-29T18:59:59+00:00",
                    {"end": 3},
                    service_date="2026-07-30",
                ),
                delay_dynamo_item(
                    "2026-07-29T19:00:00+00:00",
                    {"after": 4},
                    service_date="2026-07-30",
                ),
            ]
        )

        result = handler.query_train_delay_analysis(
            client,
            "delay-summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 2)
        self.assertEqual(result["observationStart"], "2026-07-28T19:00:00+00:00")
        self.assertEqual(result["observationEnd"], "2026-07-29T18:59:59+00:00")
        self.assertEqual(
            [
                query["ExpressionAttributeValues"][":service_date"]["S"]
                for query in client.queries
            ],
            ["2026-07-29", "2026-07-30"],
        )

    def test_connection_scan_applies_delay_and_returns_readable_trace(self) -> None:
        index = connection_index_fixture()
        result = handler.journey_search.search_index(
            index,
            {"538C": Decimal(5)},
            {
                "serviceDate": "2026-08-14", "originStation": "西大路",
                "destinationStation": "京都", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
        )

        self.assertEqual(result["totalMatchCount"], 1)
        self.assertEqual(result["matches"][0]["departureTimeMinutes"], 605)
        self.assertEqual(result["matches"][0]["arrivalTimeMinutes"], 613)
        self.assertEqual(result["matches"][0]["discoverySource"], "timetable-graph")
        self.assertGreater(result["trace"]["connectionsScanned"], 0)
        self.assertEqual(result["trace"]["selectedJourneys"][0]["trips"], ["trip-direct"])

    def test_connection_scan_estimates_a_future_train_from_the_same_local_direction(self) -> None:
        index = connection_index_from_legs([
            ("observed", "100M", "姫路", "東姫路", 580, 584),
            ("candidate", "102M", "姫路", "東姫路", 610, 614),
            ("reverse", "200M", "東姫路", "姫路", 605, 609),
        ])
        request = {
            "serviceDate": "2026-08-14", "originStation": "姫路",
            "destinationStation": "東姫路", "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 0, "includeTrace": True,
        }
        result = handler.journey_search.search_index(
            index,
            {},
            request,
            operations={
                "100M": {
                    "delayMinutes": 12, "destination": "東姫路",
                    "sources": ["source-a"],
                },
                "200M": {
                    "delayMinutes": 40, "destination": "姫路",
                    "sources": ["source-a"],
                },
            },
        )

        leg = result["journeys"][0]["legs"][0]
        self.assertEqual(leg["trainNumber"], "102M")
        self.assertEqual(leg["departureTimeMinutes"], 622)
        self.assertEqual(leg["delayMinutes"], 12)
        self.assertEqual(leg["delayStatus"], "estimated")
        self.assertEqual(leg["delayBasis"], "姫路→東姫路")
        self.assertEqual(result["trace"]["estimatedDelayTrips"], 1)

    def test_connection_scan_does_not_estimate_from_reverse_or_remote_trains(self) -> None:
        index = connection_index_from_legs([
            ("remote", "100M", "姫路", "東姫路", 400, 404),
            ("reverse", "200M", "東姫路", "姫路", 605, 609),
            ("candidate", "102M", "姫路", "東姫路", 610, 614),
        ])
        result = handler.journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "姫路",
                "destinationStation": "東姫路", "departureTimeMinutes": 600,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
            operations={
                "100M": {
                    "delayMinutes": 20, "destination": "東姫路",
                    "sources": ["source-a"],
                },
                "200M": {
                    "delayMinutes": 30, "destination": "姫路",
                    "sources": ["source-a"],
                },
            },
        )

        leg = result["journeys"][0]["legs"][0]
        self.assertEqual(leg["departureTimeMinutes"], 610)
        self.assertEqual(leg["delayMinutes"], 0)
        self.assertNotIn("delayStatus", leg)

    def test_connection_scan_allows_one_transfer_only_with_enough_time(self) -> None:
        index = connection_index_fixture()
        request = {
            "serviceDate": "2026-08-14", "originStation": "向日町",
            "destinationStation": "大阪", "departureTimeMinutes": 580.0,
            "limit": 3, "maxTransfers": 1, "includeTrace": True,
        }
        result = handler.journey_search.search_index(index, {}, request)

        self.assertEqual(result["journeys"][0]["transferCount"], 1)
        self.assertEqual(
            [leg["serviceUid"] for leg in result["journeys"][0]["legs"]],
            ["trip-direct", "trip-transfer"],
        )
        self.assertEqual(result["matches"], [])
        self.assertEqual(result["trace"]["stationTransferRulesUsed"], {})

        tight_index = connection_index_fixture()
        tight_index["connections"][2]["departure_time_minutes"] = 612
        tight_result = handler.journey_search.search_index(tight_index, {}, request)
        self.assertEqual(tight_result["journeys"], [])
        self.assertGreater(tight_result["trace"]["labelsRejectedByTransferTime"], 0)

    def test_connection_scan_supports_multiple_transfers_and_transfer_pace(self) -> None:
        request = {
            "serviceDate": "2026-08-14",
            "originStation": "A", "destinationStation": "D",
            "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        result = handler.journey_search.search_index(
            multi_transfer_index_fixture(), {}, request
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 2)
        self.assertEqual(
            [leg["trainNumber"] for leg in result["journeys"][0]["legs"]],
            ["1M", "2M", "3M"],
        )
        self.assertEqual(
            [leg["serviceDestination"] for leg in result["journeys"][0]["legs"]],
            ["B", "C", "D"],
        )

        relaxed = handler.journey_search.search_index(
            multi_transfer_index_fixture(), {},
            {**request, "transferPace": "relaxed"},
        )
        self.assertEqual(relaxed["journeys"], [])

    def test_connection_scan_does_not_transfer_between_same_named_stations(self) -> None:
        request = {
            "serviceDate": "2026-08-14",
            "originStation": "清音", "destinationStation": "出雲市",
            "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        index = connection_index_from_legs([
            ("ibara", "1321D", "清音", "小田", 600, 619),
            ("sanin", "324D", "小田", "出雲市", 641, 661),
        ])

        result = handler.journey_search.search_index(index, {}, request)

        self.assertEqual(result["journeys"], [])
        self.assertGreater(
            result["trace"]["labelsRejectedByNonUniqueStation"], 0
        )

    def test_connection_scan_can_prefer_a_later_departure(self) -> None:
        request = {
            "serviceDate": "2026-08-14",
            "originStation": "A", "destinationStation": "D",
            "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        balanced = handler.journey_search.search_index(
            preference_index_fixture(), {}, request
        )
        latest = handler.journey_search.search_index(
            preference_index_fixture(), {},
            {**request, "rankingPreference": "latest-departure"},
        )

        self.assertEqual(balanced["journeys"][0]["departureTimeMinutes"], 600)
        self.assertEqual(latest["journeys"][0]["departureTimeMinutes"], 615)

    def test_connection_scan_applies_destination_changes_and_cancellations(self) -> None:
        request = {
            "serviceDate": "2026-08-14", "originStation": "向日町",
            "destinationStation": "大阪", "departureTimeMinutes": 580,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        destination_changed = handler.journey_search.search_index(
            connection_index_fixture(), {}, request,
            operations={
                "538C": {
                    "delayMinutes": 0, "destination": "西大路", "sources": ["web"],
                },
                "1001M": {
                    "delayMinutes": 0, "destination": "大阪", "sources": ["web"],
                },
            },
            realtime_route_time=595,
        )
        cancelled = handler.journey_search.search_index(
            connection_index_fixture(), {}, request,
            operations={
                "1001M": {
                    "delayMinutes": 0, "destination": "大阪", "sources": ["web"],
                },
            },
            realtime_route_time=595,
        )

        self.assertEqual(destination_changed["journeys"], [])
        self.assertEqual(cancelled["journeys"], [])
        self.assertGreater(
            destination_changed["trace"]["realtimeActiveServicesRejected"], 0
        )

    def test_direct_index_compares_direct_and_one_transfer_journeys(self) -> None:
        result = handler.journey_search.direct_service_journey_search.search_index(
            direct_service_index_fixture(),
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 1)
        self.assertEqual(
            [leg["trainNumber"] for leg in result["journeys"][0]["legs"]],
            ["100M", "200M"],
        )
        self.assertEqual(result["journeys"][0]["arrivalTimeMinutes"], 625)
        self.assertEqual(
            [leg["serviceDestination"] for leg in result["journeys"][0]["legs"]],
            ["乗換", "到着"],
        )
        self.assertEqual(
            result["journeys"][0]["legs"][0]["stops"],
            [
                {"stationName": "出発", "departureTimeMinutes": 600.0},
                {"stationName": "乗換", "arrivalTimeMinutes": 610.0},
            ],
        )
        self.assertEqual(result["journeys"][1]["transferCount"], 0)
        self.assertEqual(result["trace"]["strategy"], "direct-service-index")
        self.assertEqual(
            result["trace"]["selectedJourneys"][0]["transferStations"],
            ["乗換"],
        )
        self.assertEqual(
            result["trace"]["selectedJourneys"][0]["transferWaitMinutes"],
            [5.0],
        )

    def test_direct_index_rejects_tight_transfer_and_applies_delay(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["second"]["calls"][0]["departure_time_minutes"] = 614
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {"100M": Decimal(5), "300M": Decimal(5)},
            {
                "serviceDate": "2026-08-14", "originStation": "出発駅",
                "destinationStation": "到着駅", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertTrue(all(
            journey["transferCount"] == 0 for journey in result["journeys"]
        ))
        self.assertEqual(result["journeys"][0]["departureTimeMinutes"], 605)
        self.assertEqual(result["journeys"][0]["arrivalTimeMinutes"], 645)
        self.assertGreater(
            result["trace"]["secondBoardingsRejectedByTransferTime"], 0
        )

    def test_direct_index_estimates_a_future_direct_train_delay(self) -> None:
        index = {
            "schema_version": "direct-service-index-v1",
            "service_date": "2026-08-14",
            "services": {
                "observed": direct_service(
                    "observed", "100M",
                    [("姫路", None, 580), ("東姫路", 584, None)],
                ),
                "candidate": direct_service(
                    "candidate", "102M",
                    [("姫路", None, 610), ("東姫路", 614, None)],
                ),
            },
            "station_origins": {"姫路": ["observed", "candidate"]},
        }
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "姫路",
                "destinationStation": "東姫路", "departureTimeMinutes": 600,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
            operations={
                "100M": {
                    "delayMinutes": 8, "destination": "東姫路",
                    "sources": ["source-a"],
                },
            },
        )

        leg = result["journeys"][0]["legs"][0]
        self.assertEqual(leg["departureTimeMinutes"], 618)
        self.assertEqual(leg["arrivalTimeMinutes"], 622)
        self.assertEqual(leg["delayStatus"], "estimated")
        self.assertEqual(result["trace"]["estimatedDelayTrips"], 1)

    def test_direct_index_can_limit_the_search_to_direct_journeys(self) -> None:
        result = handler.journey_search.direct_service_journey_search.search_index(
            direct_service_index_fixture(),
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
        )

        self.assertEqual(len(result["journeys"]), 1)
        self.assertEqual(result["journeys"][0]["transferCount"], 0)
        self.assertEqual(result["journeys"][0]["legs"][0]["trainNumber"], "300M")
        self.assertEqual(result["trace"]["transferCandidates"], 0)

    def test_direct_index_prefers_a_close_direct_arrival(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["second"]["calls"][1]["arrival_time_minutes"] = 635
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 0)
        self.assertEqual(result["journeys"][0]["arrivalTimeMinutes"], 640)
        self.assertEqual(result["journeys"][1]["arrivalTimeMinutes"], 635)

    def test_direct_index_uses_the_realtime_destination_as_authoritative(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["direct"]["calls"].insert(
            1,
            {
                "station_name": "途中",
                "arrival_time_minutes": 620,
                "departure_time_minutes": 621,
            },
        )
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
            operations={
                "300M": {
                    "delayMinutes": 0,
                    "destination": "途中",
                    "sources": ["source-a"],
                },
            },
            realtime_route_time=590,
        )

        self.assertNotIn(
            "300M",
            [
                leg["trainNumber"]
                for journey in result["journeys"]
                for leg in journey["legs"]
            ],
        )

    def test_journey_search_loads_the_direct_index_for_one_transfer(self) -> None:
        handler.journey_search._index_cache.clear()
        client = FakeS3(direct_service_index_fixture())

        result = handler.journey_search.search(
            client,
            bucket="private-bucket",
            prefix="timetable",
            value={
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 1)
        self.assertEqual(
            client.requests[0]["Key"],
            "timetable/normalized/2026-08-14/direct-service-index.json.gz",
        )

    def test_journey_search_uses_a_fresh_current_snapshot_only(self) -> None:
        handler.journey_search._index_cache.clear()
        snapshot = {
            "collectedAt": "2026-08-14T01:00:00+00:00",
            "failedSources": [],
            "trains": {
                "100M": {
                    "delayMinutes": 5,
                    "destination": "乗換",
                    "sources": ["source-a"],
                },
                "200M": {
                    "delayMinutes": 5,
                    "destination": "到着",
                    "sources": ["source-a"],
                },
            },
        }
        client = FakeS3(direct_service_index_fixture(), snapshot)
        request = {
            "serviceDate": "2026-08-14", "originStation": "出発",
            "destinationStation": "到着", "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 1, "includeTrace": True,
        }

        current = handler.journey_search.search(
            client,
            bucket="private-bucket",
            prefix="timetable",
            snapshot_bucket="web-bucket",
            value=request,
            now=datetime(2026, 8, 14, 1, 0, tzinfo=timezone.utc),
        )

        self.assertTrue(current["realtime"]["applied"])
        self.assertEqual(current["journeys"][0]["legs"][0]["delayMinutes"], 5)
        self.assertIn(
            "api/traffic/delays.json",
            [item["Key"] for item in client.requests],
        )

        client.requests.clear()
        future = handler.journey_search.search(
            client,
            bucket="private-bucket",
            prefix="timetable",
            snapshot_bucket="web-bucket",
            value={**request, "serviceDate": "2026-08-15"},
            now=datetime(2026, 8, 14, 1, 0, tzinfo=timezone.utc),
        )

        self.assertFalse(future["realtime"]["applied"])
        self.assertEqual(future["realtime"]["reason"], "future-or-past-service-date")
        self.assertNotIn(
            "api/traffic/delays.json",
            [item["Key"] for item in client.requests],
        )


def connection_index_fixture():
    return {
        "schema_version": "timetable-connection-index-v1",
        "service_date": "2026-08-14",
        "default_transfer_minutes": 5,
        "station_transfer_minutes": {},
        "trips": {
            "trip-direct": {
                "service_uid": "trip-direct", "train_no": "538C",
                "service_type": "普通", "train_name": "",
            },
            "trip-transfer": {
                "service_uid": "trip-transfer", "train_no": "1001M",
                "service_type": "新快速", "train_name": "",
            },
        },
        "connections": [
            {
                "connection_id": "direct:0", "trip_id": "trip-direct",
                "from_station": "向日町", "to_station": "西大路",
                "departure_time_minutes": 590, "arrival_time_minutes": 598,
                "stop_sequence": 0,
            },
            {
                "connection_id": "direct:1", "trip_id": "trip-direct",
                "from_station": "西大路", "to_station": "京都",
                "departure_time_minutes": 600, "arrival_time_minutes": 608,
                "stop_sequence": 1,
            },
            {
                "connection_id": "transfer:0", "trip_id": "trip-transfer",
                "from_station": "京都", "to_station": "大阪",
                "departure_time_minutes": 615, "arrival_time_minutes": 640,
                "stop_sequence": 0,
            },
        ],
    }


def multi_transfer_index_fixture():
    return connection_index_from_legs([
        ("first", "1M", "A", "B", 600, 610),
        ("second", "2M", "B", "C", 615, 625),
        ("third", "3M", "C", "D", 630, 640),
    ])


def preference_index_fixture():
    return connection_index_from_legs([
        ("early", "10M", "A", "D", 600, 660),
        ("late-first", "11M", "A", "B", 615, 625),
        ("late-second", "12M", "B", "D", 630, 662),
    ])


def connection_index_from_legs(legs):
    return {
        "schema_version": "timetable-connection-index-v1",
        "service_date": "2026-08-14",
        "default_transfer_minutes": 5,
        "station_transfer_minutes": {},
        "trips": {
            trip_id: {
                "service_uid": trip_id,
                "train_no": train_number,
                "service_type": "普通",
                "train_name": "",
                "origin_station": origin,
                "destination_station": destination,
            }
            for trip_id, train_number, origin, destination, _, _ in legs
        },
        "connections": [
            {
                "connection_id": f"{trip_id}:0",
                "trip_id": trip_id,
                "from_station": origin,
                "to_station": destination,
                "departure_time_minutes": departure,
                "arrival_time_minutes": arrival,
                "stop_sequence": 0,
            }
            for trip_id, _, origin, destination, departure, arrival in legs
        ],
    }


def direct_service_index_fixture():
    services = {
        "direct": direct_service(
            "direct", "300M",
            [("出発", None, 600), ("到着", 640, None)],
        ),
        "first": direct_service(
            "first", "100M",
            [("出発", None, 600), ("乗換", 610, None)],
        ),
        "second": direct_service(
            "second", "200M",
            [("乗換", None, 615), ("到着", 625, None)],
        ),
    }
    return {
        "schema_version": "direct-service-index-v1",
        "service_date": "2026-08-14",
        "timetable_kind": "weekday",
        "services": services,
        "station_origins": {
            "出発": ["direct", "first"],
            "乗換": ["second"],
        },
    }


def direct_service(service_uid, train_no, calls):
    return {
        "service_uid": service_uid,
        "train_no": train_no,
        "service_type": "普通",
        "train_name": "",
        "origin_station": calls[0][0],
        "destination_station": calls[-1][0],
        "calls": [
            {
                "station_name": station,
                **({"arrival_time_minutes": arrival} if arrival is not None else {}),
                **({"departure_time_minutes": departure} if departure is not None else {}),
            }
            for station, arrival, departure in calls
        ],
    }


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


def delay_dynamo_item(
    collected_at,
    train_delays,
    failures=0,
    service_date="2026-07-29",
):
    return {
        "serviceDate": {"S": service_date},
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
