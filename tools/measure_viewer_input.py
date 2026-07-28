#!/usr/bin/env python3
"""Measure the size and integrity of TransitForge viewer input files."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


TRAIN_SCHEMA = "train-index-v1"
PATH_SCHEMA = "train-path-catalog-v1"
STOP_FIELDS = (
    "seq",
    "station_name",
    "event",
    "time",
    "normalized_time",
    "time_minutes",
    "route_meter",
    "route_time_minutes",
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as input_file:
        return json.load(input_file)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def duplicate_count(values: Iterable[Any]) -> int:
    counts = Counter(value for value in values if isinstance(value, str) and value)
    return sum(count - 1 for count in counts.values() if count > 1)


def maximum_concurrent(intervals: Iterable[tuple[float, float]]) -> int:
    events: dict[float, list[int]] = {}
    for start, end in intervals:
        if start > end:
            continue
        changes = events.setdefault(start, [0, 0])
        changes[0] += 1
        changes = events.setdefault(end, [0, 0])
        changes[1] += 1

    active = maximum = 0
    for time in sorted(events):
        starts, ends = events[time]
        active += starts
        maximum = max(maximum, active)
        active -= ends
    return maximum


def measure(train_path: Path, catalog_path: Path) -> dict[str, Any]:
    train_index = load_json(train_path)
    path_catalog = load_json(catalog_path)
    if not isinstance(train_index, dict) or not isinstance(path_catalog, dict):
        raise ValueError("Both input files must contain a JSON object")

    trains = train_index.get("trains", [])
    paths = path_catalog.get("paths", [])
    if not isinstance(trains, list) or not isinstance(paths, list):
        raise ValueError("'trains' and 'paths' must be JSON arrays")

    path_ids = {
        path.get("path_id")
        for path in paths
        if isinstance(path, dict)
        and isinstance(path.get("path_id"), str)
        and path.get("path_id")
    }
    total_coordinates = 0
    maximum_coordinates = 0
    invalid_coordinates = 0
    coord_count_mismatches = 0
    bounds: list[float] | None = None

    for path in paths:
        if not isinstance(path, dict):
            continue
        coordinates = path.get("route_coords")
        if not isinstance(coordinates, list):
            coordinates = []
        total_coordinates += len(coordinates)
        maximum_coordinates = max(maximum_coordinates, len(coordinates))
        if path.get("coord_count") != len(coordinates):
            coord_count_mismatches += 1
        for coordinate in coordinates:
            if (
                not isinstance(coordinate, list)
                or len(coordinate) != 2
                or not all(is_number(value) for value in coordinate)
            ):
                invalid_coordinates += 1
                continue
            longitude, latitude = coordinate
            if bounds is None:
                bounds = [longitude, latitude, longitude, latitude]
            else:
                bounds[0] = min(bounds[0], longitude)
                bounds[1] = min(bounds[1], latitude)
                bounds[2] = max(bounds[2], longitude)
                bounds[3] = max(bounds[3], latitude)

    missing_path_id = 0
    missing_path_reference = 0
    incomplete_stops = 0
    invalid_position_stops = 0
    reversed_time_trains = 0
    reversed_distance_trains = 0
    insufficient_position_stops = 0
    scheduled_intervals: list[tuple[float, float]] = []
    drawable_intervals: list[tuple[float, float]] = []

    for train in trains:
        if not isinstance(train, dict):
            insufficient_position_stops += 1
            continue
        path_id = train.get("path_id")
        if not isinstance(path_id, str) or not path_id:
            missing_path_id += 1
            has_path = False
        else:
            has_path = path_id in path_ids
            if not has_path:
                missing_path_reference += 1

        stops = train.get("stops")
        if not isinstance(stops, list):
            stops = []
        valid_positions: list[tuple[float, float]] = []
        for stop in stops:
            if not isinstance(stop, dict):
                incomplete_stops += 1
                invalid_position_stops += 1
                continue
            if any(field not in stop or stop[field] is None for field in STOP_FIELDS):
                incomplete_stops += 1
            route_time = stop.get("route_time_minutes")
            route_meter = stop.get("route_meter")
            if not is_number(route_time) or not is_number(route_meter):
                invalid_position_stops += 1
                continue
            valid_positions.append((route_time, route_meter))

        if len(valid_positions) < 2:
            insufficient_position_stops += 1
            continue
        times = [position[0] for position in valid_positions]
        distances = [position[1] for position in valid_positions]
        if any(later < earlier for earlier, later in zip(times, times[1:])):
            reversed_time_trains += 1
        if any(later < earlier for earlier, later in zip(distances, distances[1:])):
            reversed_distance_trains += 1
        interval = (min(times), max(times))
        scheduled_intervals.append(interval)
        if has_path:
            drawable_intervals.append(interval)

    return {
        "files": {
            "train_index_bytes": train_path.stat().st_size,
            "path_catalog_bytes": catalog_path.stat().st_size,
        },
        "scale": {
            "train_count": len(trains),
            "path_count": len(paths),
            "total_coordinate_count": total_coordinates,
            "maximum_coordinates_per_path": maximum_coordinates,
            "geographic_bbox": bounds,
            "maximum_concurrent_scheduled_trains": maximum_concurrent(scheduled_intervals),
            "maximum_concurrent_drawable_trains": maximum_concurrent(drawable_intervals),
        },
        "integrity": {
            "train_schema_version_valid": train_index.get("schema_version") == TRAIN_SCHEMA,
            "path_schema_version_valid": path_catalog.get("schema_version") == PATH_SCHEMA,
            "trains_without_path_id": missing_path_id,
            "trains_with_missing_path": missing_path_reference,
            "stops_missing_required_fields": incomplete_stops,
            "stops_with_invalid_position_values": invalid_position_stops,
            "trains_with_insufficient_position_stops": insufficient_position_stops,
            "duplicate_service_uids": duplicate_count(
                train.get("service_uid") for train in trains if isinstance(train, dict)
            ),
            "duplicate_path_ids": duplicate_count(
                path.get("path_id") for path in paths if isinstance(path, dict)
            ),
            "paths_with_coord_count_mismatch": coord_count_mismatches,
            "invalid_coordinates": invalid_coordinates,
            "trains_with_reversed_route_time": reversed_time_trains,
            "trains_with_reversed_route_meter": reversed_distance_trains,
        },
        "definitions": {
            "concurrent_interval": "inclusive first-to-last valid route_time_minutes",
            "drawable_train": "has an existing path_id and at least two valid position stops",
            "required_stop_fields": list(STOP_FIELDS),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("train_index", type=Path)
    parser.add_argument("path_catalog", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        report = measure(args.train_index, args.path_catalog)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
