#!/usr/bin/env python3
"""Build the compact TransitForge station-to-line catalog from N02 station GeoJSON."""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "station-line-catalog-v1"

TARGET_OPERATOR_ALIASES = {
    "IRいしかわ鉄道": "IRいしかわ鉄道",
    "WILLER TRAINS": "京都丹後鉄道",
    "京都丹後鉄道": "京都丹後鉄道",
    "あいの風とやま鉄道": "あいの風とやま鉄道",
    "えちごトキめき鉄道": "えちごトキめき鉄道",
    "のと鉄道": "のと鉄道",
    "ハピラインふくい": "ハピラインふくい",
    "九州旅客鉄道": "九州旅客鉄道",
    "井原鉄道": "井原鉄道",
    "伊勢鉄道": "伊勢鉄道",
    "四国旅客鉄道": "四国旅客鉄道",
    "土佐くろしお鉄道": "土佐くろしお鉄道",
    "智頭急行": "智頭急行",
    "東海旅客鉄道": "東海旅客鉄道",
    "若桜鉄道": "若桜鉄道",
    "西日本旅客鉄道": "西日本旅客鉄道",
    "錦川鉄道": "錦川鉄道",
}


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def normalize_station_name(value: str) -> str:
    return normalize_text(value).replace("ヶ", "ケ")


def mean_coordinate(geometry: Any) -> tuple[float, float] | None:
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return None
    valid = [
        coordinate
        for coordinate in coordinates
        if (
            isinstance(coordinate, list)
            and len(coordinate) >= 2
            and isinstance(coordinate[0], (int, float))
            and isinstance(coordinate[1], (int, float))
        )
    ]
    if not valid:
        return None
    return (
        sum(coordinate[0] for coordinate in valid) / len(valid),
        sum(coordinate[1] for coordinate in valid) / len(valid),
    )


def build_catalog(source: dict[str, Any], source_name: str) -> dict[str, Any]:
    features = source.get("features")
    if source.get("type") != "FeatureCollection" or not isinstance(features, list):
        raise ValueError("Source must be a GeoJSON FeatureCollection")

    coordinates_by_line_station: dict[
        tuple[str, str, str], list[tuple[float, float]]
    ] = defaultdict(list)

    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        raw_operator = properties.get("N02_004")
        raw_line = properties.get("N02_003")
        raw_station = properties.get("N02_005")
        if not all(isinstance(value, str) and value for value in (raw_operator, raw_line, raw_station)):
            continue

        operator = TARGET_OPERATOR_ALIASES.get(normalize_text(raw_operator))
        if operator is None:
            continue
        line = normalize_text(raw_line)
        station = normalize_station_name(raw_station)
        coordinate = mean_coordinate(feature.get("geometry"))
        if coordinate:
            coordinates_by_line_station[(operator, line, station)].append(coordinate)

    lines: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for (operator, line, station), coordinates in coordinates_by_line_station.items():
        longitude = sum(coordinate[0] for coordinate in coordinates) / len(coordinates)
        latitude = sum(coordinate[1] for coordinate in coordinates) / len(coordinates)
        lines[(operator, line)].append(
            {
                "name": station,
                "coordinate": [round(longitude, 6), round(latitude, 6)],
            }
        )

    catalog_lines = []
    for (operator, line), stations in sorted(lines.items()):
        catalog_lines.append(
            {
                "operator": operator,
                "line": line,
                "stations": sorted(stations, key=lambda station: station["name"]),
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "source": source_name,
        "lines": catalog_lines,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="N02-25_Station.geojson")
    parser.add_argument("output", type=Path, help="Generated station_line_catalog.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        with args.source.open(encoding="utf-8") as source_file:
            source = json.load(source_file)
        catalog = build_catalog(source, args.source.name)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8") as output_file:
            json.dump(catalog, output_file, ensure_ascii=False, separators=(",", ":"))
            output_file.write("\n")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
