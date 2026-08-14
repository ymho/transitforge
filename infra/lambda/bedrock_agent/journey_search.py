from __future__ import annotations

import gzip
import json
import unicodedata
from decimal import Decimal
from typing import Any

import direct_service_journey_search
from dynamodb_analysis import (
    dynamo_number_map,
    dynamo_string,
    query_operating_day_summary_items,
    validate_service_date,
)
from request_contract import RequestError


MAX_ROUTE_TIME_MINUTES = 48 * 60
MAX_TRANSFERS = 3
_index_cache: dict[str, tuple[str, dict[str, Any]]] = {}


def search(
    s3_client: Any,
    dynamodb_client: Any,
    *,
    bucket: str,
    prefix: str,
    delay_table: str,
    value: dict[str, Any],
) -> dict[str, Any]:
    request = _validated_request(value)
    delays = _latest_delays(dynamodb_client, delay_table, request["serviceDate"])
    if request["maxTransfers"] <= 1:
        index = _load_index(
            s3_client,
            bucket,
            prefix,
            request["serviceDate"],
            "direct-service-index.json.gz",
            "direct-service-index-v1",
        )
        result = direct_service_journey_search.search_index(index, delays, request)
    else:
        index = _load_index(
            s3_client,
            bucket,
            prefix,
            request["serviceDate"],
            "connection-index.json.gz",
            "timetable-connection-index-v1",
        )
        result = search_index(index, delays, request)
    print(json.dumps({
        "event": "journey_search_trace",
        "serviceDate": request["serviceDate"],
        "originStation": request["originStation"],
        "destinationStation": request["destinationStation"],
        "trace": result["trace"],
    }, ensure_ascii=False, separators=(",", ":")))
    if not request["includeTrace"]:
        result.pop("trace", None)
    return result


def search_index(
    index: dict[str, Any],
    delays: dict[str, Decimal],
    request: dict[str, Any],
) -> dict[str, Any]:
    if index.get("schema_version") != "timetable-connection-index-v1":
        raise RequestError(503, "指定日の接続インデックス形式が不正です。")
    trips = index.get("trips")
    raw_connections = index.get("connections")
    if not isinstance(trips, dict) or not isinstance(raw_connections, list):
        raise RequestError(503, "指定日の接続インデックス形式が不正です。")

    origin = _normalize_station(request["originStation"])
    destination = _normalize_station(request["destinationStation"])
    default_transfer = _non_negative_number(index.get("default_transfer_minutes"), 5)
    station_transfers = index.get("station_transfer_minutes")
    station_transfers = station_transfers if isinstance(station_transfers, dict) else {}
    trace: dict[str, Any] = {
        "schemaVersion": "journey-search-trace-v1",
        "indexConnections": len(raw_connections),
        "connectionsScanned": 0,
        "connectionsBeforeRequestedTime": 0,
        "connectionsWithoutReachableOrigin": 0,
        "labelsRejectedByTransferTime": 0,
        "labelsRejectedByTransferLimit": 0,
        "labelsAccepted": 0,
        "destinationImprovements": 0,
        "defaultTransferMinutes": default_transfer,
        "stationTransferRulesUsed": {},
        "selectedJourneys": [],
    }
    labels: dict[str, list[dict[str, Any]]] = {
        origin: [{
            "station": request["originStation"],
            "arrival": request["departureTimeMinutes"],
            "boardings": 0,
            "lastTrip": None,
            "path": [],
        }]
    }
    connections = sorted(
        (_expected_connection(item, trips, delays) for item in raw_connections),
        key=lambda item: (
            item["expectedDeparture"], item["expectedArrival"],
            item["trip_id"], item.get("stop_sequence", 0),
        ),
    )
    maximum_boardings = request["maxTransfers"] + 1

    for connection in connections:
        trace["connectionsScanned"] += 1
        if connection["expectedDeparture"] < request["departureTimeMinutes"]:
            trace["connectionsBeforeRequestedTime"] += 1
            continue
        from_station = _normalize_station(connection["from_station"])
        reachable = labels.get(from_station, [])
        if not reachable:
            trace["connectionsWithoutReachableOrigin"] += 1
            continue
        accepted_for_connection = False
        for label in list(reachable):
            same_trip = label["lastTrip"] == connection["trip_id"]
            new_boarding = label["lastTrip"] is None or not same_trip
            boardings = label["boardings"] + (1 if new_boarding else 0)
            if boardings > maximum_boardings:
                trace["labelsRejectedByTransferLimit"] += 1
                continue
            transfer_minutes = 0
            if label["lastTrip"] is not None and not same_trip:
                transfer_minutes = _station_transfer_minutes(
                    connection["from_station"], station_transfers, default_transfer
                )
                trace["stationTransferRulesUsed"][connection["from_station"]] = transfer_minutes
            if label["arrival"] + transfer_minutes > connection["expectedDeparture"]:
                trace["labelsRejectedByTransferTime"] += 1
                continue
            accepted_for_connection = True
            candidate = {
                "station": connection["to_station"],
                "arrival": connection["expectedArrival"],
                "boardings": boardings,
                "lastTrip": connection["trip_id"],
                "path": [*label["path"], connection],
            }
            destination_labels = labels.setdefault(
                _normalize_station(connection["to_station"]), []
            )
            key = (boardings, connection["trip_id"])
            existing = next((item for item in destination_labels
                if (item["boardings"], item["lastTrip"]) == key), None)
            if existing is None or candidate["arrival"] < existing["arrival"]:
                if existing is not None:
                    destination_labels.remove(existing)
                destination_labels.append(candidate)
                trace["labelsAccepted"] += 1
                if _normalize_station(connection["to_station"]) == destination:
                    trace["destinationImprovements"] += 1
        if not accepted_for_connection:
            continue

    journeys = [
        _journey_from_label(label, trips)
        for label in labels.get(destination, [])
        if label["path"]
    ]
    journeys.sort(key=lambda item: (
        item["arrivalTimeMinutes"], item["transferCount"],
        item["departureTimeMinutes"],
    ))
    journeys = journeys[:request["limit"]]
    trace["selectedJourneys"] = [{
        "departureTimeMinutes": item["departureTimeMinutes"],
        "arrivalTimeMinutes": item["arrivalTimeMinutes"],
        "transferCount": item["transferCount"],
        "trips": [leg["serviceUid"] for leg in item["legs"]],
    } for item in journeys]
    direct_matches = [
        _direct_match(journey)
        for journey in journeys
        if journey["transferCount"] == 0 and len(journey["legs"]) == 1
    ]
    return {
        "serviceDate": request["serviceDate"],
        "originStation": request["originStation"],
        "destinationStation": request["destinationStation"],
        "searchTimeMinutes": request["departureTimeMinutes"],
        "totalMatchCount": len(journeys),
        "matches": direct_matches,
        "journeys": journeys,
        "trace": trace,
    }


def _journey_from_label(label: dict[str, Any], trips: dict[str, Any]) -> dict[str, Any]:
    legs: list[dict[str, Any]] = []
    for connection in label["path"]:
        trip_id = connection["trip_id"]
        trip = trips.get(trip_id, {})
        if legs and legs[-1]["serviceUid"] == trip_id:
            legs[-1]["destinationStation"] = connection["to_station"]
            legs[-1]["arrivalTimeMinutes"] = connection["expectedArrival"]
            legs[-1]["scheduledArrivalTimeMinutes"] = connection["arrival_time_minutes"]
            continue
        legs.append({
            "serviceUid": trip_id,
            "trainNumber": str(trip.get("train_no") or ""),
            "serviceType": str(trip.get("service_type") or ""),
            "trainName": str(trip.get("train_name") or ""),
            "originStation": connection["from_station"],
            "destinationStation": connection["to_station"],
            "departureTimeMinutes": connection["expectedDeparture"],
            "arrivalTimeMinutes": connection["expectedArrival"],
            "scheduledDepartureTimeMinutes": connection["departure_time_minutes"],
            "scheduledArrivalTimeMinutes": connection["arrival_time_minutes"],
            "delayMinutes": connection["delayMinutes"],
        })
    return {
        "departureTimeMinutes": legs[0]["departureTimeMinutes"],
        "arrivalTimeMinutes": legs[-1]["arrivalTimeMinutes"],
        "transferCount": max(0, len(legs) - 1),
        "legs": legs,
    }


def _direct_match(journey: dict[str, Any]) -> dict[str, Any]:
    leg = journey["legs"][0]
    return {
        **leg,
        "source": "transitforge",
        "discoverySource": "timetable-graph",
        "sourceReference": "connection-scan",
    }


def _expected_connection(
    value: Any, trips: dict[str, Any], delays: dict[str, Decimal]
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestError(503, "接続インデックス内の接続形式が不正です。")
    trip_id = str(value.get("trip_id") or "")
    trip = trips.get(trip_id)
    if not isinstance(trip, dict):
        raise RequestError(503, "接続インデックス内の列車参照が不正です。")
    departure = _required_number(value.get("departure_time_minutes"))
    arrival = _required_number(value.get("arrival_time_minutes"))
    delay = max(Decimal(0), delays.get(str(trip.get("train_no") or ""), Decimal(0)))
    return {
        **value,
        "trip_id": trip_id,
        "expectedDeparture": float(Decimal(str(departure)) + delay),
        "expectedArrival": float(Decimal(str(arrival)) + delay),
        "delayMinutes": float(delay),
    }


def _validated_request(value: dict[str, Any]) -> dict[str, Any]:
    origin = value.get("originStation")
    destination = value.get("destinationStation")
    service_date = value.get("serviceDate")
    departure = value.get("departureTimeMinutes")
    limit = value.get("limit", 3)
    max_transfers = value.get("maxTransfers", 0)
    if not isinstance(origin, str) or not origin.strip():
        raise RequestError(400, "originStationが必要です。")
    if not isinstance(destination, str) or not destination.strip():
        raise RequestError(400, "destinationStationが必要です。")
    if not isinstance(service_date, str):
        raise RequestError(400, "serviceDateが必要です。")
    validate_service_date(service_date)
    if not _number_in_range(departure, 0, MAX_ROUTE_TIME_MINUTES):
        raise RequestError(400, "departureTimeMinutesが不正です。")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 5:
        raise RequestError(400, "limitは1から5にしてください。")
    if not isinstance(max_transfers, int) or isinstance(max_transfers, bool) or not 0 <= max_transfers <= MAX_TRANSFERS:
        raise RequestError(400, "maxTransfersは0から3にしてください。")
    include_trace = value.get("includeTrace", False)
    if not isinstance(include_trace, bool):
        raise RequestError(400, "includeTraceが不正です。")
    return {
        "originStation": origin.strip(), "destinationStation": destination.strip(),
        "serviceDate": service_date, "departureTimeMinutes": float(departure),
        "limit": limit, "maxTransfers": max_transfers, "includeTrace": include_trace,
    }


def _load_index(
    s3_client: Any,
    bucket: str,
    prefix: str,
    service_date: str,
    filename: str,
    schema_version: str,
) -> dict[str, Any]:
    key = f"{prefix.strip('/')}/normalized/{service_date}/{filename}"
    try:
        etag = str(s3_client.head_object(Bucket=bucket, Key=key).get("ETag", ""))
        cached = _index_cache.get(key)
        if cached is not None and cached[0] == etag:
            return cached[1]
        body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
        value = json.loads(gzip.decompress(body).decode("utf-8"))
    except Exception as error:
        raise RequestError(503, "指定日の検索インデックスを読み込めません。") from error
    if not isinstance(value, dict) or value.get("schema_version") != schema_version:
        raise RequestError(503, "指定日の検索インデックス形式が不正です。")
    _index_cache[key] = (etag, value)
    return value


def _latest_delays(dynamodb_client: Any, table: str, service_date: str) -> dict[str, Decimal]:
    if not table:
        return {}
    items = query_operating_day_summary_items(dynamodb_client, table, service_date)
    valid = [item for item in items if dynamo_string(item.get("collectedAt"))]
    if not valid:
        return {}
    latest = max(valid, key=lambda item: dynamo_string(item.get("collectedAt")) or "")
    return dynamo_number_map(latest.get("trainDelays"))


def _station_transfer_minutes(station: str, rules: dict[str, Any], fallback: float) -> float:
    normalized = _normalize_station(station)
    value = next((raw for name, raw in rules.items()
        if _normalize_station(str(name)) == normalized), fallback)
    return _non_negative_number(value, fallback)


def _normalize_station(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", value).split()).removesuffix("駅")


def _required_number(value: Any) -> float:
    if not _number_in_range(value, 0, MAX_ROUTE_TIME_MINUTES):
        raise RequestError(503, "接続インデックス内の時刻が不正です。")
    return float(value)


def _non_negative_number(value: Any, fallback: float) -> float:
    return float(value) if _number_in_range(value, 0, MAX_ROUTE_TIME_MINUTES) else fallback


def _number_in_range(value: Any, minimum: float, maximum: float) -> bool:
    return (
        isinstance(value, (int, float)) and not isinstance(value, bool)
        and value == value and minimum <= value <= maximum
    )
