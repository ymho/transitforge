from __future__ import annotations

import gzip
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import connection_scan_journey_search
import direct_service_journey_search
from dynamodb_analysis import validate_service_date
from request_contract import RequestError


MAX_ROUTE_TIME_MINUTES = 48 * 60
MAX_TRANSFERS = 3
_index_cache: dict[str, tuple[str, dict[str, Any]]] = {}
JST = timezone(timedelta(hours=9))
REALTIME_TOLERANCE = timedelta(minutes=5)


def search(
    s3_client: Any,
    *,
    bucket: str,
    prefix: str,
    snapshot_bucket: str = "",
    snapshot_key: str = "api/traffic/delays.json",
    value: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, Any]:
    request = _validated_request(value)
    operations, realtime = _current_operations(
        s3_client,
        snapshot_bucket,
        snapshot_key,
        request,
        now or datetime.now(timezone.utc),
    )
    delays = {
        train_number: Decimal(str(operation["delayMinutes"]))
        for train_number, operation in operations.items()
    }
    if request["maxTransfers"] <= 1:
        index = _load_index(
            s3_client,
            bucket,
            prefix,
            request["serviceDate"],
            "direct-service-index.json.gz",
            "direct-service-index-v1",
        )
        result = direct_service_journey_search.search_index(
            index,
            delays,
            request,
            operations=operations if realtime["applied"] else None,
            realtime_route_time=realtime.get("snapshotRouteTimeMinutes"),
        )
    else:
        index = _load_index(
            s3_client,
            bucket,
            prefix,
            request["serviceDate"],
            "connection-index.json.gz",
            "timetable-connection-index-v1",
        )
        result = search_index(
            index,
            delays,
            request,
            operations=operations if realtime["applied"] else None,
            realtime_route_time=realtime.get("snapshotRouteTimeMinutes"),
        )
    result["realtime"] = realtime
    result["trace"]["realtime"] = realtime
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
    *,
    operations: dict[str, dict[str, Any]] | None = None,
    realtime_route_time: float | None = None,
) -> dict[str, Any]:
    enriched_request = {
        "transferPace": "standard",
        "rankingPreference": "balanced",
        **request,
    }
    return connection_scan_journey_search.search_index(
        index,
        delays,
        enriched_request,
        operations=operations,
        realtime_route_time=realtime_route_time,
    )


def _validated_request(value: dict[str, Any]) -> dict[str, Any]:
    origin = value.get("originStation")
    destination = value.get("destinationStation")
    service_date = value.get("serviceDate")
    departure = value.get("departureTimeMinutes")
    limit = value.get("limit", 3)
    max_transfers = value.get("maxTransfers", 3)
    transfer_pace = value.get("transferPace", "standard")
    ranking_preference = value.get("rankingPreference", "balanced")
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
    if (
        not isinstance(max_transfers, int)
        or isinstance(max_transfers, bool)
        or not 0 <= max_transfers <= MAX_TRANSFERS
    ):
        raise RequestError(400, "maxTransfersは0から3にしてください。")
    if transfer_pace not in {"hurried", "standard", "relaxed"}:
        raise RequestError(400, "transferPaceが不正です。")
    if ranking_preference not in {
        "balanced",
        "earliest-arrival",
        "latest-departure",
        "fewest-transfers",
    }:
        raise RequestError(400, "rankingPreferenceが不正です。")
    include_trace = value.get("includeTrace", False)
    if not isinstance(include_trace, bool):
        raise RequestError(400, "includeTraceが不正です。")
    return {
        "originStation": origin.strip(),
        "destinationStation": destination.strip(),
        "serviceDate": service_date,
        "departureTimeMinutes": float(departure),
        "limit": limit,
        "maxTransfers": max_transfers,
        "transferPace": transfer_pace,
        "rankingPreference": ranking_preference,
        "includeTrace": include_trace,
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
        _index_cache.clear()
        body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
        value = json.loads(gzip.decompress(body).decode("utf-8"))
    except Exception as error:
        raise RequestError(503, "指定日の検索インデックスを読み込めません。") from error
    if not isinstance(value, dict) or value.get("schema_version") != schema_version:
        raise RequestError(503, "指定日の検索インデックス形式が不正です。")
    _index_cache[key] = (etag, value)
    return value


def _current_operations(
    s3_client: Any,
    bucket: str,
    key: str,
    request: dict[str, Any],
    now: datetime,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    current_service_date = (now.astimezone(JST) - timedelta(hours=4)).date().isoformat()
    base = {
        "applied": False,
        "reason": "future-or-past-service-date",
        "currentServiceDate": current_service_date,
    }
    if request["serviceDate"] != current_service_date:
        return {}, base
    if not bucket or not key:
        return {}, {**base, "reason": "snapshot-not-configured"}
    try:
        body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
        snapshot = json.loads(body.decode("utf-8"))
    except Exception:
        return {}, {**base, "reason": "snapshot-unavailable"}
    if not isinstance(snapshot, dict):
        return {}, {**base, "reason": "snapshot-invalid"}
    failed_sources = snapshot.get("failedSources")
    if not isinstance(failed_sources, list) or failed_sources:
        return {}, {**base, "reason": "snapshot-incomplete"}
    try:
        collected_at = datetime.fromisoformat(str(snapshot.get("collectedAt")))
    except ValueError:
        return {}, {**base, "reason": "snapshot-invalid"}
    if collected_at.tzinfo is None or abs(now - collected_at) > REALTIME_TOLERANCE:
        return {}, {**base, "reason": "snapshot-stale"}
    requested_at = (
        datetime.strptime(request["serviceDate"], "%Y-%m-%d").replace(tzinfo=JST)
        + timedelta(minutes=request["departureTimeMinutes"])
    )
    if abs(requested_at - collected_at.astimezone(JST)) > REALTIME_TOLERANCE:
        return {}, {**base, "reason": "search-time-not-current"}
    trains = snapshot.get("trains")
    if not isinstance(trains, dict):
        return {}, {**base, "reason": "snapshot-invalid"}
    operations = {
        train_number: operation
        for train_number, operation in trains.items()
        if isinstance(train_number, str)
        and isinstance(operation, dict)
        and _valid_operation(operation)
    }
    service_start = datetime.strptime(
        request["serviceDate"], "%Y-%m-%d"
    ).replace(tzinfo=JST)
    return operations, {
        **base,
        "applied": True,
        "reason": "current-complete-snapshot",
        "snapshotCollectedAt": collected_at.isoformat(),
        "snapshotRouteTimeMinutes": (
            collected_at.astimezone(JST) - service_start
        ).total_seconds() / 60,
        "operationCount": len(operations),
    }


def _valid_operation(value: dict[str, Any]) -> bool:
    delay = value.get("delayMinutes")
    return (
        isinstance(delay, (int, float))
        and not isinstance(delay, bool)
        and delay >= 0
        and isinstance(value.get("destination"), str)
        and isinstance(value.get("sources"), list)
        and all(isinstance(source, str) for source in value["sources"])
    )


def _number_in_range(value: Any, minimum: float, maximum: float) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value == value
        and minimum <= value <= maximum
    )
