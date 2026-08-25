"""Estimate delays for not-yet-observed trips from nearby trains on the same edge."""
from __future__ import annotations

from collections import defaultdict
from statistics import median
from typing import Any, Callable


CANDIDATE_HORIZON_MINUTES = 120.0
OBSERVATION_WINDOW_MINUTES = 90.0
MAX_ESTIMATED_DELAY_MINUTES = 60.0


def estimate_trip_delays(
    trips: dict[str, Any],
    edges_by_trip: dict[str, list[dict[str, Any]]],
    operations: dict[str, dict[str, Any]] | None,
    request_time_minutes: float,
    operation_for: Callable[[dict[str, Any], dict[str, dict[str, Any]]], dict[str, Any] | None],
) -> dict[str, dict[str, Any]]:
    """Return observed and locally estimated delay metadata keyed by trip id.

    A candidate is compared at its first edge after the requested time. Only
    observed trains traversing the exact same directed edge around the same
    time are used, so a delay on the reverse or a remote branch does not leak
    into the estimate.
    """
    if not operations:
        return {}

    observed_by_edge: dict[
        tuple[Any, Any], list[tuple[float, float, str]]
    ] = defaultdict(list)
    result: dict[str, dict[str, Any]] = {}
    for trip_id, trip in trips.items():
        if not isinstance(trip_id, str) or not isinstance(trip, dict):
            continue
        operation = operation_for(trip, operations)
        if operation is None:
            continue
        delay = _non_negative_delay(operation.get("delayMinutes"))
        result[trip_id] = {
            "delayMinutes": delay,
            "delayStatus": "observed",
        }
        if delay > 0:
            for edge in edges_by_trip.get(trip_id, []):
                observed_by_edge[_edge_key(edge)].append(
                    (_departure(edge) + delay, delay, trip_id)
                )

    if not observed_by_edge:
        return result

    for trip_id, trip in trips.items():
        if not isinstance(trip_id, str) or not isinstance(trip, dict) or trip_id in result:
            continue
        anchor = _candidate_anchor(
            edges_by_trip.get(trip_id, []), request_time_minutes
        )
        if anchor is None:
            continue
        nearest_by_trip: dict[str, tuple[float, float]] = {}
        for expected_departure, delay, observed_trip_id in observed_by_edge.get(
            _edge_key(anchor), []
        ):
            distance = abs(expected_departure - _departure(anchor))
            previous = nearest_by_trip.get(observed_trip_id)
            if distance <= OBSERVATION_WINDOW_MINUTES and (
                previous is None or distance < previous[0]
            ):
                nearest_by_trip[observed_trip_id] = (distance, delay)
        samples = list(nearest_by_trip.values())
        if not samples:
            continue
        samples.sort(key=lambda item: item[0])
        nearest_delays = [delay for _, delay in samples[:3]]
        estimate = min(MAX_ESTIMATED_DELAY_MINUTES, float(median(nearest_delays)))
        if estimate <= 0:
            continue
        result[trip_id] = {
            "delayMinutes": estimate,
            "delayStatus": "estimated",
            "delaySampleCount": len(nearest_delays),
            "delayBasis": f'{anchor["from_station"]}→{anchor["to_station"]}',
        }
    return result


def _candidate_anchor(
    edges: list[dict[str, Any]], request_time_minutes: float
) -> dict[str, Any] | None:
    latest = request_time_minutes + CANDIDATE_HORIZON_MINUTES
    return next(
        (
            edge
            for edge in edges
            if request_time_minutes <= _departure(edge) <= latest
        ),
        None,
    )


def _edge_key(edge: dict[str, Any]) -> tuple[Any, Any]:
    return edge.get("from_station"), edge.get("to_station")


def _departure(edge: dict[str, Any]) -> float:
    value = edge.get("departure_time_minutes")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return float("inf")


def _non_negative_delay(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
        return float(value)
    return 0.0
