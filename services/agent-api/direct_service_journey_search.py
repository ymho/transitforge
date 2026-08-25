"""Search direct and one-transfer journeys from direct-service-index-v1."""
from __future__ import annotations

import bisect
import unicodedata
from decimal import Decimal
from typing import Any

from journey_delay_prediction import estimate_trip_delays
from journey_operations import delay_info, effective_calls, operation_for
from journey_constraints import (
    eligible_service_ids,
    journey_satisfies_requirements,
    response_constraints,
    trace_constraints,
)
from request_contract import RequestError


DEFAULT_TRANSFER_MINUTES = 5.0
TRANSFER_RANKING_PENALTY_MINUTES = 10.0

# 駅ごとの例外はここへ集約する
# 値は同一駅内で次の列車へ乗車するまでに必要な分数
STATION_TRANSFER_MINUTES: dict[str, float] = {}


def search_index(
    index: dict[str, Any],
    delays: dict[str, Decimal],
    request: dict[str, Any],
    *,
    operations: dict[str, dict[str, Any]] | None = None,
    realtime_route_time: float | None = None,
) -> dict[str, Any]:
    if index.get("schema_version") != "direct-service-index-v1":
        raise RequestError(503, "指定日の直通インデックス形式が不正です。")
    raw_services = index.get("services")
    station_origins = index.get("station_origins")
    if not isinstance(raw_services, dict) or not isinstance(station_origins, dict):
        raise RequestError(503, "指定日の直通インデックス形式が不正です。")
    eligible_ids = eligible_service_ids(raw_services, request)
    services = {
        service_id: service
        for service_id, service in raw_services.items()
        if isinstance(service, dict)
        and str(service_id) in eligible_ids
    }

    station_names = {
        _normalize(name): name
        for name in station_origins
        if isinstance(name, str)
    }
    origin = _normalize(request["originStation"])
    destination = _normalize(request["destinationStation"])
    origin_name = station_names.get(origin)
    trace: dict[str, Any] = {
        "schemaVersion": "journey-search-trace-v1",
        "strategy": "direct-service-index",
        "indexServices": len(raw_services),
        **trace_constraints(request),
        "excludedServices": len(raw_services) - len(services),
        "originServices": 0,
        "firstBoardingsEvaluated": 0,
        "firstBoardingsBeforeRequestedTime": 0,
        "transferStationsEvaluated": 0,
        "secondBoardingsEvaluated": 0,
        "secondBoardingsRejectedByTransferTime": 0,
        "directCandidates": 0,
        "transferCandidates": 0,
        "realtimeActiveServicesRejected": 0,
        "defaultTransferMinutes": DEFAULT_TRANSFER_MINUTES,
        "transferRankingPenaltyMinutes": TRANSFER_RANKING_PENALTY_MINUTES,
        "stationTransferRulesUsed": {},
        "selectedJourneys": [],
    }
    if not origin_name or origin == destination:
        return _response(request, [], trace)

    delay_predictions = estimate_trip_delays(
        services,
        {
            str(service_id): _service_edges(service)
            for service_id, service in services.items()
            if isinstance(service_id, str) and isinstance(service, dict)
        },
        operations,
        request["departureTimeMinutes"],
        operation_for,
    )
    trace["observedDelayTrips"] = sum(
        info.get("delayStatus") == "observed" and info["delayMinutes"] > 0
        for info in delay_predictions.values()
    )
    trace["estimatedDelayTrips"] = sum(
        info.get("delayStatus") == "estimated"
        for info in delay_predictions.values()
    )

    service_ids = station_origins.get(origin_name)
    if not isinstance(service_ids, list):
        return _response(request, [], trace)
    trace["originServices"] = len(service_ids)
    first_boardings: list[tuple[float, float, int, dict[str, Any]]] = []
    for service_id in service_ids:
        service = services.get(str(service_id))
        if not isinstance(service, dict):
            continue
        delay = delay_info(str(service.get("service_uid") or ""), service, delays, operations, delay_predictions)["delayMinutes"]
        calls = effective_calls(service, operations, _normalize)
        if _missing_active_operation(
            service, calls, operations, realtime_route_time
        ):
            trace["realtimeActiveServicesRejected"] += 1
            continue
        for index_in_calls, call in enumerate(calls):
            if _normalize(call.get("station_name")) != origin:
                continue
            scheduled_departure = _departure_time(call)
            if scheduled_departure is None:
                continue
            departure = scheduled_departure + delay
            if departure < request["departureTimeMinutes"]:
                trace["firstBoardingsBeforeRequestedTime"] += 1
                continue
            first_boardings.append(
                (departure, scheduled_departure, index_in_calls, service)
            )
    first_boardings.sort(key=lambda item: (
        item[0], item[1], str(item[3].get("service_uid") or "")
    ))

    candidates: dict[tuple[Any, ...], dict[str, Any]] = {}
    destination_options_by_station: dict[
        str, tuple[list[dict[str, Any]], list[float]]
    ] = {}
    evaluated_transfer_stations: set[str] = set()
    limit = request["limit"]

    for departure, scheduled_departure, origin_index, first_service in first_boardings:
        worst_score = _worst_selected_score(candidates, limit)
        if worst_score is not None and departure > worst_score:
            break
        trace["firstBoardingsEvaluated"] += 1
        calls = effective_calls(first_service, operations, _normalize)
        service_delay_info = delay_info(
            str(first_service.get("service_uid") or ""), first_service, delays, operations, delay_predictions
        )
        delay = service_delay_info["delayMinutes"]
        direct_leg = _leg_to_destination(
            first_service,
            calls,
            origin_index,
            destination,
            departure,
            scheduled_departure,
            service_delay_info,
        )
        if direct_leg is not None:
            if _add_candidate(candidates, [direct_leg], request):
                trace["directCandidates"] += 1
        if request["maxTransfers"] == 0:
            continue

        for transfer_index in range(origin_index + 1, len(calls)):
            transfer_call = calls[transfer_index]
            transfer_station = transfer_call.get("station_name")
            transfer = _normalize(transfer_station)
            if not transfer or transfer == destination:
                continue
            scheduled_arrival = _arrival_time(transfer_call)
            if scheduled_arrival is None:
                continue
            arrival = scheduled_arrival + delay
            transfer_minutes = _transfer_minutes(transfer)
            if transfer in STATION_TRANSFER_MINUTES:
                trace["stationTransferRulesUsed"][str(transfer_station)] = transfer_minutes
            if transfer not in destination_options_by_station:
                options = _destination_options(
                    transfer,
                    destination,
                    station_names,
                    station_origins,
                    services,
                    delays,
                    operations,
                    realtime_route_time,
                    delay_predictions,
                )
                destination_options_by_station[transfer] = (
                    options,
                    [option["departureTimeMinutes"] for option in options],
                )
            if transfer not in evaluated_transfer_stations:
                evaluated_transfer_stations.add(transfer)
                trace["transferStationsEvaluated"] += 1
            options, option_departures = destination_options_by_station[transfer]
            earliest_departure = arrival + transfer_minutes
            start = bisect.bisect_left(
                option_departures,
                earliest_departure,
            )
            trace["secondBoardingsRejectedByTransferTime"] += start
            for second_leg in options[start:]:
                trace["secondBoardingsEvaluated"] += 1
                if second_leg["serviceUid"] == str(first_service.get("service_uid") or ""):
                    continue
                worst_score = _worst_selected_score(candidates, limit)
                if (
                    worst_score is not None
                    and second_leg["departureTimeMinutes"]
                    + TRANSFER_RANKING_PENALTY_MINUTES > worst_score
                ):
                    break
                first_leg = _leg(
                    first_service,
                    calls[origin_index],
                    transfer_call,
                    calls[origin_index:transfer_index + 1],
                    str(calls[-1].get("station_name") or ""),
                    departure,
                    arrival,
                    scheduled_departure,
                    scheduled_arrival,
                    service_delay_info,
                )
                if _add_candidate(
                    candidates, [first_leg, second_leg], request
                ):
                    trace["transferCandidates"] += 1

    journeys = sorted(candidates.values(), key=_journey_rank)[:limit]
    trace["selectedJourneys"] = [
        {
            "departureTimeMinutes": journey["departureTimeMinutes"],
            "arrivalTimeMinutes": journey["arrivalTimeMinutes"],
            "transferCount": journey["transferCount"],
            "transferStations": [
                leg["destinationStation"] for leg in journey["legs"][:-1]
            ],
            "transferWaitMinutes": [
                journey["legs"][index + 1]["departureTimeMinutes"]
                - leg["arrivalTimeMinutes"]
                for index, leg in enumerate(journey["legs"][:-1])
            ],
            "trips": [leg["serviceUid"] for leg in journey["legs"]],
        }
        for journey in journeys
    ]
    return _response(request, journeys, trace)


def _destination_options(
    origin: str,
    destination: str,
    station_names: dict[str, str],
    station_origins: dict[str, Any],
    services: dict[str, Any],
    delays: dict[str, Decimal],
    operations: dict[str, dict[str, Any]] | None,
    realtime_route_time: float | None,
    delay_predictions: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    station_name = station_names.get(origin)
    service_ids = station_origins.get(station_name, []) if station_name else []
    if not isinstance(service_ids, list):
        return []
    options: list[dict[str, Any]] = []
    for service_id in service_ids:
        service = services.get(str(service_id))
        if not isinstance(service, dict):
            continue
        calls = effective_calls(service, operations, _normalize)
        if _missing_active_operation(
            service, calls, operations, realtime_route_time
        ):
            continue
        service_delay_info = delay_info(
            str(service.get("service_uid") or ""), service, delays, operations, delay_predictions
        )
        delay = service_delay_info["delayMinutes"]
        for origin_index, call in enumerate(calls):
            if _normalize(call.get("station_name")) != origin:
                continue
            scheduled_departure = _departure_time(call)
            if scheduled_departure is None:
                continue
            leg = _leg_to_destination(
                service,
                calls,
                origin_index,
                destination,
                scheduled_departure + delay,
                scheduled_departure,
                service_delay_info,
            )
            if leg is not None:
                options.append(leg)
    return sorted(options, key=lambda item: (
        item["departureTimeMinutes"],
        item["arrivalTimeMinutes"],
        item["serviceUid"],
    ))


def _leg_to_destination(
    service: dict[str, Any],
    calls: list[dict[str, Any]],
    origin_index: int,
    destination: str,
    departure: float,
    scheduled_departure: float,
    delay_info: dict[str, Any],
) -> dict[str, Any] | None:
    delay = delay_info["delayMinutes"]
    for destination_index, destination_call in enumerate(
        calls[origin_index + 1:],
        start=origin_index + 1,
    ):
        if _normalize(destination_call.get("station_name")) != destination:
            continue
        scheduled_arrival = _arrival_time(destination_call)
        if scheduled_arrival is None or scheduled_arrival < scheduled_departure:
            continue
        return _leg(
            service,
            calls[origin_index],
            destination_call,
            calls[origin_index:destination_index + 1],
            str(calls[-1].get("station_name") or ""),
            departure,
            scheduled_arrival + delay,
            scheduled_departure,
            scheduled_arrival,
            delay_info,
        )
    return None


def _leg(
    service: dict[str, Any],
    origin_call: dict[str, Any],
    destination_call: dict[str, Any],
    segment_calls: list[dict[str, Any]],
    service_destination: str,
    departure: float,
    arrival: float,
    scheduled_departure: float,
    scheduled_arrival: float,
    delay_info: dict[str, Any],
) -> dict[str, Any]:
    delay = delay_info["delayMinutes"]
    return {
        "serviceUid": str(service.get("service_uid") or ""),
        "trainNumber": str(service.get("train_no") or ""),
        "serviceType": str(service.get("service_type") or ""),
        "trainName": str(service.get("train_name") or ""),
        "serviceDestination": service_destination,
        "originStation": str(origin_call.get("station_name") or ""),
        "destinationStation": str(destination_call.get("station_name") or ""),
        "departureTimeMinutes": departure,
        "arrivalTimeMinutes": arrival,
        "scheduledDepartureTimeMinutes": scheduled_departure,
        "scheduledArrivalTimeMinutes": scheduled_arrival,
        "delayMinutes": delay,
        **(
            {"delayStatus": delay_info["delayStatus"]}
            if "delayStatus" in delay_info
            else {}
        ),
        **(
            {"delaySampleCount": delay_info["delaySampleCount"]}
            if "delaySampleCount" in delay_info
            else {}
        ),
        **(
            {"delayBasis": delay_info["delayBasis"]}
            if "delayBasis" in delay_info
            else {}
        ),
        "stops": [
            {
                "stationName": str(call.get("station_name") or ""),
                **(
                    {"arrivalTimeMinutes": arrival_time}
                    if (arrival_time := _adjusted_time(
                        call.get("arrival_time_minutes"), delay
                    )) is not None
                    else {}
                ),
                **(
                    {"departureTimeMinutes": departure_time}
                    if (departure_time := _adjusted_time(
                        call.get("departure_time_minutes"), delay
                    )) is not None
                    else {}
                ),
            }
            for call in segment_calls
        ],
    }


def _add_candidate(
    candidates: dict[tuple[Any, ...], dict[str, Any]],
    legs: list[dict[str, Any]],
    request: dict[str, Any],
) -> bool:
    if not journey_satisfies_requirements(legs, request):
        return False
    key = tuple(
        (leg["serviceUid"], leg["departureTimeMinutes"], leg["arrivalTimeMinutes"])
        for leg in legs
    )
    journey = {
        "departureTimeMinutes": legs[0]["departureTimeMinutes"],
        "arrivalTimeMinutes": legs[-1]["arrivalTimeMinutes"],
        "transferCount": len(legs) - 1,
        "legs": legs,
    }
    current = candidates.get(key)
    if current is None or _journey_rank(journey) < _journey_rank(current):
        candidates[key] = journey
    return True


def _response(
    request: dict[str, Any],
    journeys: list[dict[str, Any]],
    trace: dict[str, Any],
) -> dict[str, Any]:
    direct_matches = [
        {
            **journey["legs"][0],
            "source": "transitforge",
            "discoverySource": "direct-service-index",
            "sourceReference": "direct-service-index-v1",
        }
        for journey in journeys
        if journey["transferCount"] == 0
    ]
    return {
        "serviceDate": request["serviceDate"],
        "originStation": request["originStation"],
        "destinationStation": request["destinationStation"],
        "searchTimeMinutes": request["departureTimeMinutes"],
        "totalMatchCount": len(journeys),
        "matches": direct_matches,
        "journeys": journeys,
        **response_constraints(request),
        "trace": trace,
    }


def _calls(service: dict[str, Any]) -> list[dict[str, Any]]:
    value = service.get("calls")
    return [call for call in value if isinstance(call, dict)] if isinstance(value, list) else []


def _departure_time(call: dict[str, Any]) -> float | None:
    return _time(call.get("departure_time_minutes"), call.get("arrival_time_minutes"))


def _arrival_time(call: dict[str, Any]) -> float | None:
    return _time(call.get("arrival_time_minutes"), call.get("departure_time_minutes"))


def _time(primary: Any, fallback: Any) -> float | None:
    value = primary if _is_time(primary) else fallback
    return float(value) if _is_time(value) else None


def _adjusted_time(value: Any, delay: float) -> float | None:
    return float(value) + delay if _is_time(value) else None


def _is_time(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value == value
        and 0 <= value <= 48 * 60
    )


def _service_edges(service: dict[str, Any]) -> list[dict[str, Any]]:
    calls = _calls(service)
    edges: list[dict[str, Any]] = []
    for current, following in zip(calls, calls[1:]):
        departure = _departure_time(current)
        if departure is None:
            continue
        edges.append({
            "from_station": str(current.get("station_name") or ""),
            "to_station": str(following.get("station_name") or ""),
            "departure_time_minutes": departure,
        })
    return edges


def _missing_active_operation(
    service: dict[str, Any],
    calls: list[dict[str, Any]],
    operations: dict[str, dict[str, Any]] | None,
    realtime_route_time: float | None,
) -> bool:
    if operations is None or realtime_route_time is None:
        return False
    if operation_for(service, operations) is not None or not calls:
        return False
    start = _departure_time(calls[0])
    end = _arrival_time(calls[-1])
    return (
        start is not None
        and end is not None
        and start <= realtime_route_time <= end
    )




def _transfer_minutes(station: str) -> float:
    return STATION_TRANSFER_MINUTES.get(station, DEFAULT_TRANSFER_MINUTES)


def _worst_selected_score(
    candidates: dict[tuple[Any, ...], dict[str, Any]],
    limit: int,
) -> float | None:
    if len(candidates) < limit:
        return None
    return _journey_score(sorted(candidates.values(), key=_journey_rank)[:limit][-1])


def _journey_score(journey: dict[str, Any]) -> float:
    return (
        journey["arrivalTimeMinutes"]
        + journey["transferCount"] * TRANSFER_RANKING_PENALTY_MINUTES
    )


def _journey_rank(journey: dict[str, Any]) -> tuple[Any, ...]:
    return (
        _journey_score(journey),
        journey["transferCount"],
        journey["arrivalTimeMinutes"],
        journey["departureTimeMinutes"],
        tuple(leg["serviceUid"] for leg in journey["legs"]),
    )


def _normalize(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(unicodedata.normalize("NFKC", value).split()).removesuffix("駅")
