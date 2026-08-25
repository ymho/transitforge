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
        / "services"
        / "agent-api"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location("agent_api_handler", path)
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
            "usage": {"inputTokens": 12, "outputTokens": 4, "totalTokens": 16},
            "metrics": {"latencyMs": 25},
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
