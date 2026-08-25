"""Deterministic search over the two private representative timetables."""
from __future__ import annotations

import gzip
import json
import unicodedata
from typing import Any


class TimetableSearchError(ValueError):
    pass


_cache: dict[str, tuple[str, dict[str, Any]]] = {}


def search(
    s3_client: Any,
    bucket: str,
    prefix: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    kind = request.get("timetableKind")
    query = request.get("query")
    mode = request.get("mode")
    target_time = request.get("targetTimeMinutes")
    limit = request.get("limit", 5)
    if kind not in {"weekday", "weekend_holiday"}:
        raise TimetableSearchError("timetableKindが不正です。")
    if not isinstance(query, str) or not query.strip() or len(query) > 200:
        raise TimetableSearchError("queryが不正です。")
    if mode not in {"active", "arrivals", "departures"}:
        raise TimetableSearchError("modeが不正です。")
    if target_time is not None and (
        not isinstance(target_time, (int, float))
        or isinstance(target_time, bool)
        or not 0 <= target_time <= 2_160
    ):
        raise TimetableSearchError("targetTimeMinutesが不正です。")
    if not isinstance(limit, int) or isinstance(limit, bool):
        raise TimetableSearchError("limitが不正です。")
    limit = max(1, min(5, limit))

    timetable = _load(s3_client, bucket, prefix, kind)
    normalized_query = _normalize(query)
    trains = timetable.get("trains")
    if not isinstance(trains, list):
        raise RuntimeError("Representative timetable has no trains array")
    station_names = {
        _normalize(stop.get("station_name"))
        for train in trains if isinstance(train, dict)
        for stop in train.get("stops", []) if isinstance(stop, dict)
        if isinstance(stop.get("station_name"), str)
        and _normalize(stop["station_name"]) in normalized_query
    }
    service_types = {
        _normalize(train.get("service_type"))
        for train in trains if isinstance(train, dict)
        if isinstance(train.get("service_type"), str)
        and _normalize(train["service_type"]) in normalized_query
    }
    train_names = {
        _normalize(train.get("train_name"))
        for train in trains if isinstance(train, dict)
        if isinstance(train.get("train_name"), str) and train.get("train_name")
        and _normalize(train["train_name"]) in normalized_query
    }
    train_numbers = {
        _normalize(train.get("train_no"))
        for train in trains if isinstance(train, dict)
        if isinstance(train.get("train_no"), str)
        and len(_normalize(train["train_no"])) >= 2
        and _normalize(train["train_no"]) in normalized_query
    }
    if not any((station_names, service_types, train_names, train_numbers)):
        return _response(timetable, kind, mode, target_time, [], 0)

    ranked: list[tuple[float, dict[str, Any]]] = []
    for train in trains:
        if not isinstance(train, dict) or not _train_matches(
            train, station_names, service_types, train_names, train_numbers
        ):
            continue
        matching_stops = _matching_stops(train, station_names, mode, target_time)
        if mode == "active" and target_time is not None:
            times = [
                stop.get("route_time_minutes")
                for stop in train.get("stops", []) if isinstance(stop, dict)
                if isinstance(stop.get("route_time_minutes"), (int, float))
            ]
            if not times or not min(times) <= target_time <= max(times):
                continue
        elif mode != "active" and not matching_stops:
            continue
        nearest = (
            min(
                (abs(stop["routeTimeMinutes"] - target_time) for stop in matching_stops),
                default=0,
            )
            if target_time is not None else 0
        )
        ranked.append((nearest, {
            "trainNumber": train.get("train_no", ""),
            "serviceType": train.get("service_type", ""),
            "trainName": train.get("train_name", ""),
            "origin": train.get("origin_station", ""),
            "destination": train.get("destination_station", ""),
            "matchingStops": matching_stops[:4],
        }))
    ranked.sort(key=lambda item: (item[0], item[1]["trainNumber"]))
    return _response(
        timetable, kind, mode, target_time,
        [item[1] for item in ranked[:limit]], len(ranked),
    )


def _load(s3_client: Any, bucket: str, prefix: str, kind: str) -> dict[str, Any]:
    key = f"{prefix.strip('/')}/{kind}.json.gz"
    etag = str(s3_client.head_object(Bucket=bucket, Key=key).get("ETag", ""))
    cached = _cache.get(kind)
    if cached is not None and cached[0] == etag:
        return cached[1]
    body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
    value = json.loads(gzip.decompress(body))
    if not isinstance(value, dict) or value.get("schema_version") != "ai-timetable-v1":
        raise RuntimeError("Representative timetable schema is invalid")
    _cache[kind] = (etag, value)
    return value


def _train_matches(
    train: dict[str, Any], stations: set[str], service_types: set[str],
    train_names: set[str], train_numbers: set[str],
) -> bool:
    train_stations = {
        _normalize(stop.get("station_name"))
        for stop in train.get("stops", []) if isinstance(stop, dict)
        if isinstance(stop.get("station_name"), str)
    }
    return (
        (not stations or bool(stations & train_stations))
        and (not service_types or _normalize(train.get("service_type")) in service_types)
        and (not train_names or _normalize(train.get("train_name")) in train_names)
        and (not train_numbers or _normalize(train.get("train_no")) in train_numbers)
    )


def _matching_stops(
    train: dict[str, Any], stations: set[str], mode: str, target_time: float | None
) -> list[dict[str, Any]]:
    result = []
    event_text = "着" if mode == "arrivals" else "発" if mode == "departures" else None
    for stop in train.get("stops", []):
        if not isinstance(stop, dict):
            continue
        station = stop.get("station_name")
        route_time = stop.get("route_time_minutes")
        if not isinstance(station, str) or not isinstance(route_time, (int, float)):
            continue
        if stations and _normalize(station) not in stations:
            continue
        if event_text is not None and event_text not in str(stop.get("event", "")):
            continue
        if target_time is not None and abs(route_time - target_time) > 30:
            continue
        result.append({
            "stationName": station,
            "event": stop.get("event", ""),
            "routeTimeMinutes": route_time,
        })
    return result


def _response(
    timetable: dict[str, Any], kind: str, mode: str,
    target_time: float | None, matches: list[dict[str, Any]], total: int,
) -> dict[str, Any]:
    return {
        "timetableKind": kind,
        "serviceDate": timetable.get("service_date"),
        "mode": mode,
        "targetTimeMinutes": target_time,
        "totalMatchCount": total,
        "matches": matches,
    }


def _normalize(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return unicodedata.normalize("NFKC", value).strip().replace("ヶ", "ケ")
