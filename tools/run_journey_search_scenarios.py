#!/usr/bin/env python3
"""Run readable journey-search scenarios against the deterministic CSA."""
from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any


ROOT = Path(__file__).parents[1]
AGENT_API = ROOT / "services" / "agent-api"
SCENARIO_FILE = ROOT / "tests" / "fixtures" / "journey-search-scenarios.json"
sys.path.insert(0, str(AGENT_API))

import journey_search  # noqa: E402


def load_scenarios(path: Path = SCENARIO_FILE) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError("経路検索シナリオは配列で記述してください")
    return value


def build_connection_index(scenario: dict[str, Any]) -> dict[str, Any]:
    service_date = str(scenario.get("serviceDate", "2026-08-15"))
    services = scenario.get("services")
    if not isinstance(services, list) or not services:
        raise ValueError(f"{scenario.get('id')}: servicesが必要です")

    trips: dict[str, dict[str, Any]] = {}
    connections: list[dict[str, Any]] = []
    for service in services:
        service_id = str(service["id"])
        stops = service.get("stops")
        if not isinstance(stops, list) or len(stops) < 2:
            raise ValueError(f"{scenario.get('id')}: {service_id}の停車駅が不足しています")
        trips[service_id] = {
            "service_uid": service_id,
            "train_no": str(service["trainNumber"]),
            "service_type": str(service.get("serviceType", "普通")),
            "train_name": str(service.get("trainName", "")),
            "origin_station": str(stops[0]["station"]),
            "destination_station": str(stops[-1]["station"]),
        }
        for sequence, (origin, destination) in enumerate(zip(stops, stops[1:])):
            departure = origin.get("departure")
            arrival = destination.get("arrival")
            if not _is_number(departure) or not _is_number(arrival):
                raise ValueError(
                    f"{scenario.get('id')}: {service_id}の区間{sequence + 1}に発着時刻が必要です"
                )
            connections.append({
                "connection_id": f"{service_id}:{sequence}",
                "trip_id": service_id,
                "from_station": str(origin["station"]),
                "to_station": str(destination["station"]),
                "departure_time_minutes": departure,
                "arrival_time_minutes": arrival,
                "stop_sequence": sequence,
            })

    connections.sort(key=lambda item: (
        item["departure_time_minutes"],
        item["arrival_time_minutes"],
        item["trip_id"],
    ))
    return {
        "schema_version": "timetable-connection-index-v1",
        "service_date": service_date,
        "default_transfer_minutes": scenario.get("defaultTransferMinutes", 5),
        "station_transfer_minutes": scenario.get("stationTransferMinutes", {}),
        "trips": trips,
        "connections": connections,
    }


def build_direct_service_index(scenario: dict[str, Any]) -> dict[str, Any]:
    services: dict[str, dict[str, Any]] = {}
    station_origins: dict[str, list[str]] = {}
    for service in scenario["services"]:
        service_id = str(service["id"])
        calls = []
        for stop in service["stops"]:
            call = {"station_name": str(stop["station"])}
            if _is_number(stop.get("arrival")):
                call["arrival_time_minutes"] = stop["arrival"]
            if _is_number(stop.get("departure")):
                call["departure_time_minutes"] = stop["departure"]
                station_origins.setdefault(str(stop["station"]), []).append(service_id)
            calls.append(call)
        services[service_id] = {
            "service_uid": service_id,
            "train_no": str(service["trainNumber"]),
            "service_type": str(service.get("serviceType", "普通")),
            "train_name": str(service.get("trainName", "")),
            "origin_station": str(service["stops"][0]["station"]),
            "destination_station": str(service["stops"][-1]["station"]),
            "calls": calls,
        }
    return {
        "schema_version": "direct-service-index-v1",
        "service_date": str(scenario.get("serviceDate", "2026-08-15")),
        "timetable_kind": "scenario",
        "services": services,
        "station_origins": station_origins,
    }


def run_scenario(scenario: dict[str, Any]) -> dict[str, Any]:
    request = {
        "serviceDate": str(scenario.get("serviceDate", "2026-08-15")),
        "limit": 3,
        "maxTransfers": 3,
        "includeTrace": True,
        "transferPace": "standard",
        "rankingPreference": "balanced",
        **scenario["request"],
    }
    delays = {
        train_number: Decimal(str(delay))
        for train_number, delay in scenario.get("delays", {}).items()
    }
    search = journey_search.search_index
    index = build_connection_index(scenario)
    if request["maxTransfers"] <= 1:
        search = journey_search.direct_service_journey_search.search_index
        index = build_direct_service_index(scenario)
    return search(
        index,
        delays,
        request,
        operations=scenario.get("operations"),
        realtime_route_time=scenario.get("realtimeRouteTime"),
    )


def assert_scenario(scenario: dict[str, Any], result: dict[str, Any]) -> None:
    expected = scenario["expect"]
    journeys = result["journeys"]
    if "journeyCount" in expected:
        _expect_equal(scenario, "経路数", len(journeys), expected["journeyCount"])

    first_expected = expected.get("firstJourney")
    if first_expected is not None:
        if not journeys:
            raise AssertionError(f"{scenario['id']}: 先頭経路がありません")
        first = journeys[0]
        actual = {
            "trains": [leg["trainNumber"] for leg in first["legs"]],
            "departure": first["departureTimeMinutes"],
            "arrival": first["arrivalTimeMinutes"],
            "transferCount": first["transferCount"],
            "transferStations": [
                leg["destinationStation"] for leg in first["legs"][:-1]
            ],
        }
        for key, value in first_expected.items():
            _expect_equal(scenario, f"先頭経路.{key}", actual[key], value)

    trace = result["trace"]
    for key, minimum in expected.get("traceMinimum", {}).items():
        actual = trace.get(key)
        if not _is_number(actual) or actual < minimum:
            raise AssertionError(
                f"{scenario['id']}: trace.{key}は{minimum}以上を期待しましたが{actual}でした"
            )


def _expect_equal(
    scenario: dict[str, Any], label: str, actual: Any, expected: Any,
) -> None:
    if actual != expected:
        raise AssertionError(
            f"{scenario['id']}: {label}は{expected!r}を期待しましたが{actual!r}でした"
        )


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _summary(result: dict[str, Any]) -> str:
    journeys = result["journeys"]
    if not journeys:
        return "経路なし"
    first = journeys[0]
    trains = " → ".join(leg["trainNumber"] for leg in first["legs"])
    return (
        f"{trains}  {first['departureTimeMinutes']:g} → "
        f"{first['arrivalTimeMinutes']:g}  乗換{first['transferCount']}回"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="経路検索シナリオを実行します")
    parser.add_argument("patterns", nargs="*", help="IDまたは名前の絞り込み")
    parser.add_argument("--list", action="store_true", help="シナリオ一覧だけを表示")
    args = parser.parse_args()
    scenarios = load_scenarios()
    if args.patterns:
        patterns = [pattern.casefold() for pattern in args.patterns]
        scenarios = [
            scenario for scenario in scenarios
            if any(
                pattern in f"{scenario['id']} {scenario['name']}".casefold()
                for pattern in patterns
            )
        ]
    if not scenarios:
        parser.error("条件に合うシナリオがありません")

    failures = 0
    for scenario in scenarios:
        if args.list:
            print(f"{scenario['id']}  {scenario['name']}")
            continue
        try:
            result = run_scenario(scenario)
            assert_scenario(scenario, result)
            print(f"✓ {scenario['id']}  {scenario['name']}  {_summary(result)}")
        except (AssertionError, KeyError, TypeError, ValueError) as error:
            failures += 1
            print(f"✗ {scenario.get('id', 'unknown')}  {error}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
