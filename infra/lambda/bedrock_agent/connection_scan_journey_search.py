"""Multi-criteria Connection Scan Algorithm for generated daily timetables."""
from __future__ import annotations

import bisect
import unicodedata
from decimal import Decimal
from typing import Any

from request_contract import RequestError


MAX_LABELS_PER_STATION_AND_BOARDING = 8
TRANSFER_PACE_ADJUSTMENTS = {
    "hurried": (0.7, 2.0),
    "standard": (1.0, 0.0),
    "relaxed": (1.0, 5.0),
}
ARRIVAL_TOLERANCE_MINUTES = {
    "earliest-arrival": 0.0,
    "balanced": 30.0,
    "latest-departure": 45.0,
    "fewest-transfers": 120.0,
}
# v1は駅名だけを持つため同名の別駅を識別できない。
# 駅IDを持つ後続スキーマへ移行するまで判明した同名駅での乗換を禁止する。
NON_UNIQUE_STATION_NAMES_V1 = frozenset({"小田"})


def search_index(
    index: dict[str, Any],
    delays: dict[str, Decimal],
    request: dict[str, Any],
    *,
    operations: dict[str, dict[str, Any]] | None = None,
    realtime_route_time: float | None = None,
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
    maximum_boardings = request["maxTransfers"] + 1
    trace: dict[str, Any] = {
        "schemaVersion": "journey-search-trace-v1",
        "strategy": "multi-criteria-connection-scan",
        "indexConnections": len(raw_connections),
        "connectionsScanned": 0,
        "connectionsBeforeRequestedTime": 0,
        "connectionsWithoutReachableOrigin": 0,
        "labelsRejectedByTransferTime": 0,
        "labelsRejectedByNonUniqueStation": 0,
        "labelsRejectedByTransferLimit": 0,
        "labelsRejectedByDominance": 0,
        "labelsTrimmed": 0,
        "labelsAccepted": 0,
        "destinationImprovements": 0,
        "scanStoppedAfterBestArrival": False,
        "arrivalToleranceMinutes": ARRIVAL_TOLERANCE_MINUTES[
            request["rankingPreference"]
        ],
        "realtimeActiveServicesRejected": 0,
        "defaultTransferMinutes": default_transfer,
        "transferPace": request["transferPace"],
        "rankingPreference": request["rankingPreference"],
        "stationTransferRulesUsed": {},
        "selectedJourneys": [],
    }
    if not origin or origin == destination:
        return _response(request, [], trace)

    trip_delays = {
        trip_id: _delay_for_trip(trip, delays, operations)
        for trip_id, trip in trips.items()
        if isinstance(trip_id, str) and isinstance(trip, dict)
    }
    policies = _realtime_trip_policies(
        raw_connections, trips, operations, realtime_route_time
    )
    connections = _connections_in_scan_order(raw_connections, trip_delays)
    start_index = 0
    if not delays:
        start_index = bisect.bisect_left(
            connections,
            request["departureTimeMinutes"],
            key=lambda item: _required_number(item.get("departure_time_minutes")),
        )
        trace["connectionsBeforeRequestedTime"] = start_index

    origin_label = {
        "station": request["originStation"],
        "arrival": request["departureTimeMinutes"],
        "boardings": 0,
        "lastTrip": None,
        "journeyDeparture": request["departureTimeMinutes"],
        "parent": None,
        "connection": None,
    }
    station_labels: dict[tuple[str, int], list[dict[str, Any]]] = {
        (origin, 0): [origin_label]
    }
    trip_labels: dict[tuple[str, int], dict[str, Any]] = {}
    best_destination_arrival: float | None = None

    for raw_connection in connections[start_index:]:
        connection = _expected_connection(raw_connection, trips, trip_delays)
        if (
            best_destination_arrival is not None
            and connection["expectedDeparture"]
            > best_destination_arrival
            + ARRIVAL_TOLERANCE_MINUTES[request["rankingPreference"]]
        ):
            trace["scanStoppedAfterBestArrival"] = True
            break
        trace["connectionsScanned"] += 1
        if connection["expectedDeparture"] < request["departureTimeMinutes"]:
            trace["connectionsBeforeRequestedTime"] += 1
            continue
        trip_id = connection["trip_id"]
        policy = policies.get(trip_id)
        if policy == "unavailable" or (
            isinstance(policy, int)
            and int(connection.get("stop_sequence", 0)) >= policy
        ):
            trace["realtimeActiveServicesRejected"] += 1
            continue
        from_station = _normalize_station(connection["from_station"])
        to_station = _normalize_station(connection["to_station"])
        reached_connection = False

        for boardings in range(1, maximum_boardings + 1):
            sources: list[dict[str, Any]] = []
            onboard = trip_labels.get((trip_id, boardings))
            if (
                onboard is not None
                and _normalize_station(onboard["station"]) == from_station
                and onboard["arrival"] <= connection["expectedDeparture"]
            ):
                sources.append(onboard)

            for label in station_labels.get((from_station, boardings - 1), []):
                if label["lastTrip"] == trip_id:
                    continue
                if (
                    label["lastTrip"] is not None
                    and from_station in NON_UNIQUE_STATION_NAMES_V1
                ):
                    trace["labelsRejectedByNonUniqueStation"] += 1
                    continue
                transfer_minutes = 0.0
                if label["lastTrip"] is not None:
                    transfer_minutes = _paced_transfer_minutes(
                        connection["from_station"],
                        station_transfers,
                        default_transfer,
                        request["transferPace"],
                    )
                    if _has_station_transfer_rule(
                        connection["from_station"], station_transfers
                    ):
                        trace["stationTransferRulesUsed"][connection["from_station"]] = transfer_minutes
                if label["arrival"] + transfer_minutes <= connection["expectedDeparture"]:
                    sources.append(label)
                else:
                    trace["labelsRejectedByTransferTime"] += 1

            if not sources:
                continue
            source = max(
                sources,
                key=lambda label: (
                    label["journeyDeparture"],
                    -label["arrival"],
                ),
            )
            journey_departure = (
                connection["expectedDeparture"]
                if source["boardings"] == 0
                else source["journeyDeparture"]
            )
            candidate = {
                "station": connection["to_station"],
                "arrival": connection["expectedArrival"],
                "boardings": boardings,
                "lastTrip": trip_id,
                "journeyDeparture": journey_departure,
                "parent": source,
                "connection": connection,
            }
            trip_labels[(trip_id, boardings)] = candidate
            accepted, trimmed = _add_station_label(
                station_labels.setdefault((to_station, boardings), []),
                candidate,
                request,
            )
            if accepted:
                reached_connection = True
                trace["labelsAccepted"] += 1
                trace["labelsTrimmed"] += trimmed
                if to_station == destination:
                    trace["destinationImprovements"] += 1
                    best_destination_arrival = min(
                        best_destination_arrival
                        if best_destination_arrival is not None
                        else candidate["arrival"],
                        candidate["arrival"],
                    )
            else:
                trace["labelsRejectedByDominance"] += 1

        if not reached_connection:
            trace["connectionsWithoutReachableOrigin"] += 1

    destination_labels = [
        label
        for boardings in range(1, maximum_boardings + 1)
        for label in station_labels.get((destination, boardings), [])
        if (
            best_destination_arrival is None
            or label["arrival"]
            <= best_destination_arrival
            + ARRIVAL_TOLERANCE_MINUTES[request["rankingPreference"]]
        )
    ]
    journeys = _pareto_journeys([
        _journey_from_label(label, trips, operations) for label in destination_labels
    ])
    journeys.sort(key=lambda item: _journey_rank(item, request))
    journeys = journeys[:request["limit"]]
    trace["selectedJourneys"] = [
        {
            "departureTimeMinutes": item["departureTimeMinutes"],
            "arrivalTimeMinutes": item["arrivalTimeMinutes"],
            "transferCount": item["transferCount"],
            "transferStations": [
                leg["destinationStation"] for leg in item["legs"][:-1]
            ],
            "transferWaitMinutes": [
                item["legs"][index + 1]["departureTimeMinutes"]
                - leg["arrivalTimeMinutes"]
                for index, leg in enumerate(item["legs"][:-1])
            ],
            "trips": [leg["serviceUid"] for leg in item["legs"]],
        }
        for item in journeys
    ]
    return _response(request, journeys, trace)


def _connections_in_scan_order(
    connections: list[Any], trip_delays: dict[str, float]
) -> list[Any]:
    if not any(delay > 0 for delay in trip_delays.values()):
        return connections
    return sorted(
        connections,
        key=lambda item: (
            _required_number(item.get("departure_time_minutes"))
            + trip_delays.get(str(item.get("trip_id") or ""), 0.0),
            _required_number(item.get("arrival_time_minutes"))
            + trip_delays.get(str(item.get("trip_id") or ""), 0.0),
            str(item.get("trip_id") or ""),
            int(item.get("stop_sequence", 0)),
        ),
    )


def _expected_connection(
    value: Any,
    trips: dict[str, Any],
    trip_delays: dict[str, float],
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestError(503, "接続インデックス内の接続形式が不正です。")
    trip_id = str(value.get("trip_id") or "")
    if not isinstance(trips.get(trip_id), dict):
        raise RequestError(503, "接続インデックス内の列車参照が不正です。")
    departure = _required_number(value.get("departure_time_minutes"))
    arrival = _required_number(value.get("arrival_time_minutes"))
    delay = trip_delays.get(trip_id, 0.0)
    return {
        **value,
        "trip_id": trip_id,
        "expectedDeparture": departure + delay,
        "expectedArrival": arrival + delay,
        "delayMinutes": delay,
    }


def _add_station_label(
    labels: list[dict[str, Any]],
    candidate: dict[str, Any],
    request: dict[str, Any],
) -> tuple[bool, int]:
    if any(_dominates(label, candidate) for label in labels):
        return False, 0
    labels[:] = [label for label in labels if not _dominates(candidate, label)]
    labels.append(candidate)
    if len(labels) <= MAX_LABELS_PER_STATION_AND_BOARDING:
        return True, 0
    earliest = min(labels, key=lambda label: label["arrival"])
    latest = max(labels, key=lambda label: label["journeyDeparture"])
    kept = [earliest]
    if latest is not earliest:
        kept.append(latest)
    kept_ids = {id(label) for label in kept}
    ranked = sorted(labels, key=lambda label: _label_rank(label, request))
    for label in ranked:
        if id(label) not in kept_ids:
            kept.append(label)
            kept_ids.add(id(label))
        if len(kept) >= MAX_LABELS_PER_STATION_AND_BOARDING:
            break
    removed = len(labels) - len(kept)
    labels[:] = kept
    return candidate in labels, removed


def _dominates(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        left["arrival"] <= right["arrival"]
        and left["journeyDeparture"] >= right["journeyDeparture"]
        and (
            left["arrival"] < right["arrival"]
            or left["journeyDeparture"] > right["journeyDeparture"]
        )
    )


def _label_rank(label: dict[str, Any], request: dict[str, Any]) -> tuple[float, ...]:
    journey = {
        "arrivalTimeMinutes": label["arrival"],
        "departureTimeMinutes": label["journeyDeparture"],
        "transferCount": max(0, label["boardings"] - 1),
    }
    return _journey_rank(journey, request)


def _journey_rank(journey: dict[str, Any], request: dict[str, Any]) -> tuple[float, ...]:
    arrival = float(journey["arrivalTimeMinutes"])
    departure = float(journey["departureTimeMinutes"])
    transfers = int(journey["transferCount"])
    later_departure = max(0.0, departure - request["departureTimeMinutes"])
    preference = request["rankingPreference"]
    if preference == "earliest-arrival":
        return arrival, transfers, -departure
    if preference == "fewest-transfers":
        return transfers, arrival, -departure
    if preference == "latest-departure":
        return arrival - later_departure * 0.5 + transfers * 4, arrival, transfers
    return arrival + transfers * 8 - later_departure * 0.25, arrival, transfers


def _pareto_journeys(journeys: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for journey in journeys:
        key = (
            journey["departureTimeMinutes"],
            journey["arrivalTimeMinutes"],
            tuple(leg["serviceUid"] for leg in journey["legs"]),
        )
        unique[key] = journey
    values = list(unique.values())
    return [
        journey
        for journey in values
        if not any(
            other is not journey
            and other["arrivalTimeMinutes"] <= journey["arrivalTimeMinutes"]
            and other["departureTimeMinutes"] >= journey["departureTimeMinutes"]
            and other["transferCount"] <= journey["transferCount"]
            and (
                other["arrivalTimeMinutes"] < journey["arrivalTimeMinutes"]
                or other["departureTimeMinutes"] > journey["departureTimeMinutes"]
                or other["transferCount"] < journey["transferCount"]
            )
            for other in values
        )
    ]


def _journey_from_label(
    label: dict[str, Any],
    trips: dict[str, Any],
    operations: dict[str, dict[str, Any]] | None,
) -> dict[str, Any]:
    connections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = label
    while current is not None:
        connection = current.get("connection")
        if isinstance(connection, dict):
            connections.append(connection)
        current = current.get("parent")
    connections.reverse()

    legs: list[dict[str, Any]] = []
    for connection in connections:
        trip_id = connection["trip_id"]
        trip = trips.get(trip_id, {})
        operation = _operation_for(trip, operations) if operations is not None else None
        service_destination = (
            operation.get("destination")
            if operation is not None
            and "osakaloop" not in operation.get("sources", [])
            and operation.get("destination")
            else trip.get("destination_station")
        )
        if legs and legs[-1]["serviceUid"] == trip_id:
            previous_stop = legs[-1]["stops"][-1]
            previous_stop["departureTimeMinutes"] = connection["expectedDeparture"]
            legs[-1]["destinationStation"] = connection["to_station"]
            legs[-1]["arrivalTimeMinutes"] = connection["expectedArrival"]
            legs[-1]["scheduledArrivalTimeMinutes"] = connection["arrival_time_minutes"]
            legs[-1]["stops"].append({
                "stationName": connection["to_station"],
                "arrivalTimeMinutes": connection["expectedArrival"],
            })
            continue
        legs.append({
            "serviceUid": trip_id,
            "trainNumber": str(trip.get("train_no") or ""),
            "serviceType": str(trip.get("service_type") or ""),
            "trainName": str(trip.get("train_name") or ""),
            "serviceDestination": str(service_destination or ""),
            "originStation": connection["from_station"],
            "destinationStation": connection["to_station"],
            "departureTimeMinutes": connection["expectedDeparture"],
            "arrivalTimeMinutes": connection["expectedArrival"],
            "scheduledDepartureTimeMinutes": connection["departure_time_minutes"],
            "scheduledArrivalTimeMinutes": connection["arrival_time_minutes"],
            "delayMinutes": connection["delayMinutes"],
            "stops": [
                {
                    "stationName": connection["from_station"],
                    "departureTimeMinutes": connection["expectedDeparture"],
                },
                {
                    "stationName": connection["to_station"],
                    "arrivalTimeMinutes": connection["expectedArrival"],
                },
            ],
        })
    return {
        "departureTimeMinutes": legs[0]["departureTimeMinutes"],
        "arrivalTimeMinutes": legs[-1]["arrivalTimeMinutes"],
        "transferCount": max(0, len(legs) - 1),
        "legs": legs,
    }


def _realtime_trip_policies(
    connections: list[Any],
    trips: dict[str, Any],
    operations: dict[str, dict[str, Any]] | None,
    realtime_route_time: float | None,
) -> dict[str, str | int]:
    if operations is None or realtime_route_time is None:
        return {}
    bounds: dict[str, tuple[float, float]] = {}
    destination_sequences: dict[tuple[str, str], int] = {}
    for connection in connections:
        if not isinstance(connection, dict):
            continue
        trip_id = str(connection.get("trip_id") or "")
        departure = _required_number(connection.get("departure_time_minutes"))
        arrival = _required_number(connection.get("arrival_time_minutes"))
        current = bounds.get(trip_id)
        bounds[trip_id] = (
            min(current[0], departure) if current else departure,
            max(current[1], arrival) if current else arrival,
        )
        destination_sequences[(trip_id, _normalize_station(connection.get("to_station")))] = (
            int(connection.get("stop_sequence", 0)) + 1
        )

    policies: dict[str, str | int] = {}
    for trip_id, trip in trips.items():
        if not isinstance(trip_id, str) or not isinstance(trip, dict):
            continue
        operation = _operation_for(trip, operations)
        bound = bounds.get(trip_id)
        if operation is None:
            if bound and bound[0] <= realtime_route_time <= bound[1]:
                policies[trip_id] = "unavailable"
            continue
        if "osakaloop" in operation.get("sources", []):
            continue
        destination = _normalize_station(operation.get("destination"))
        scheduled = _normalize_station(trip.get("destination_station"))
        if destination and destination != scheduled:
            cutoff = destination_sequences.get((trip_id, destination))
            policies[trip_id] = cutoff if cutoff is not None else "unavailable"
    return policies


def _operation_for(
    trip: dict[str, Any], operations: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    train_number = str(trip.get("train_no") or "")
    operation = operations.get(train_number)
    if operation is not None:
        return operation
    if "関空快速" in str(trip.get("service_type") or "") and train_number.endswith("M"):
        alias = operations.get(train_number[:-1])
        if alias is not None and "osakaloop" in alias.get("sources", []):
            return alias
    return None


def _delay_for_trip(
    trip: dict[str, Any],
    delays: dict[str, Decimal],
    operations: dict[str, dict[str, Any]] | None,
) -> float:
    if operations is not None:
        operation = _operation_for(trip, operations)
        if operation is not None:
            return float(operation["delayMinutes"])
    delay = delays.get(str(trip.get("train_no") or ""), Decimal(0))
    return float(max(Decimal(0), delay))


def _paced_transfer_minutes(
    station: str,
    rules: dict[str, Any],
    fallback: float,
    pace: str,
) -> float:
    base = _station_transfer_minutes(station, rules, fallback)
    factor, addition = TRANSFER_PACE_ADJUSTMENTS[pace]
    return max(2.0, round(base * factor + addition, 1))


def _station_transfer_minutes(
    station: str, rules: dict[str, Any], fallback: float
) -> float:
    normalized = _normalize_station(station)
    for name, value in rules.items():
        if _normalize_station(name) == normalized:
            return _non_negative_number(value, fallback)
    return fallback


def _has_station_transfer_rule(station: str, rules: dict[str, Any]) -> bool:
    normalized = _normalize_station(station)
    return any(_normalize_station(name) == normalized for name in rules)


def _response(
    request: dict[str, Any], journeys: list[dict[str, Any]], trace: dict[str, Any]
) -> dict[str, Any]:
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
        "transferPace": request["transferPace"],
        "rankingPreference": request["rankingPreference"],
        "maxTransfers": request["maxTransfers"],
        "totalMatchCount": len(journeys),
        "matches": direct_matches,
        "journeys": journeys,
        "trace": trace,
    }


def _direct_match(journey: dict[str, Any]) -> dict[str, Any]:
    return {
        **journey["legs"][0],
        "source": "transitforge",
        "discoverySource": "timetable-graph",
        "sourceReference": "multi-criteria-connection-scan",
    }


def _normalize_station(value: Any) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).replace("駅", "").strip()


def _required_number(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    raise RequestError(503, "接続インデックス内の時刻形式が不正です。")


def _non_negative_number(value: Any, fallback: float) -> float:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
    ):
        return float(value)
    return float(fallback)
