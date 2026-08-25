from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from dynamodb_analysis import (
    average_for_response,
    dynamo_number,
    dynamo_number_map,
    dynamo_string,
    number_for_response,
    query_operating_day_summary_items,
    validate_service_date,
)


JST = timezone(timedelta(hours=9))


def query_daily_congestion_analysis(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    validate_service_date(service_date)
    items = query_operating_day_summary_items(
        dynamodb_client,
        summary_table,
        service_date,
    )
    samples = sorted(
        (
            sample
            for item in items
            if (sample := congestion_sample(item)) is not None
        ),
        key=lambda sample: sample["collectedAt"],
    )
    if not samples:
        return {
            "serviceDate": service_date,
            "sampleCount": 0,
            "observationStart": None,
            "observationEnd": None,
            "peak": None,
            "hourly": empty_hourly_analysis(),
            "trainStats": [],
        }

    peak = max(
        samples,
        key=lambda sample: (sample["totalCongestion"], sample["collectedAt"]),
    )
    return {
        "serviceDate": service_date,
        "sampleCount": len(samples),
        "observationStart": samples[0]["collectedAt"],
        "observationEnd": samples[-1]["collectedAt"],
        "peak": peak_response(peak),
        "hourly": hourly_analysis(samples),
        "trainStats": daily_train_stats(samples),
    }


def congestion_sample(item: dict[str, Any]) -> dict[str, Any] | None:
    collected_at = dynamo_string(item.get("collectedAt"))
    source_updated_at = dynamo_string(item.get("sourceUpdatedAt"))
    if collected_at is None or source_updated_at is None:
        return None
    try:
        parsed_collected_at = datetime.fromisoformat(collected_at)
    except ValueError:
        return None
    if parsed_collected_at.tzinfo is None:
        return None
    return {
        "collectedAt": collected_at,
        "sourceUpdatedAt": source_updated_at,
        "hourJst": parsed_collected_at.astimezone(JST).hour,
        "totalCongestion": dynamo_number(item.get("totalCongestion")),
        "trainCount": dynamo_number(item.get("trainCount")),
        "carCount": dynamo_number(item.get("carCount")),
        "trainTotals": dynamo_number_map(item.get("trainTotals")),
    }


def peak_response(peak: dict[str, Any]) -> dict[str, Any]:
    top_trains = sorted(
        (
            {
                "trainNumber": train_number,
                "totalCongestion": number_for_response(total),
            }
            for train_number, total in peak["trainTotals"].items()
        ),
        key=lambda item: (-item["totalCongestion"], item["trainNumber"]),
    )[:5]
    return {
        "collectedAt": peak["collectedAt"],
        "sourceUpdatedAt": peak["sourceUpdatedAt"],
        "totalCongestion": number_for_response(peak["totalCongestion"]),
        "trainCount": int(peak["trainCount"]),
        "carCount": int(peak["carCount"]),
        "topTrains": top_trains,
    }


def empty_hourly_analysis() -> list[dict[str, Any]]:
    return [hourly_response(hour, []) for hour in range(24)]


def hourly_analysis(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples_by_hour: list[list[dict[str, Any]]] = [[] for _ in range(24)]
    for sample in samples:
        samples_by_hour[sample["hourJst"]].append(sample)
    return [
        hourly_response(hour, hour_samples)
        for hour, hour_samples in enumerate(samples_by_hour)
    ]


def hourly_response(
    hour: int,
    samples: list[dict[str, Any]],
) -> dict[str, Any]:
    if not samples:
        return {
            "hourJst": hour,
            "sampleCount": 0,
            "averageTotalCongestion": None,
            "peakTotalCongestion": None,
            "peakCollectedAt": None,
            "averageTrainCount": None,
            "topTrain": None,
        }

    peak = max(
        samples,
        key=lambda sample: (sample["totalCongestion"], sample["collectedAt"]),
    )
    train_stats = aggregate_train_stats(samples)
    top_train = (
        max(
            train_stats.items(),
            key=lambda item: (
                item[1]["sum"] / item[1]["observedSampleCount"],
                item[1]["peak"],
                item[0],
            ),
        )
        if train_stats
        else None
    )
    return {
        "hourJst": hour,
        "sampleCount": len(samples),
        "averageTotalCongestion": average_for_response(
            sum((sample["totalCongestion"] for sample in samples), Decimal(0)),
            len(samples),
        ),
        "peakTotalCongestion": number_for_response(peak["totalCongestion"]),
        "peakCollectedAt": peak["collectedAt"],
        "averageTrainCount": average_for_response(
            sum((sample["trainCount"] for sample in samples), Decimal(0)),
            len(samples),
        ),
        "topTrain": (
            train_stat_response(top_train[0], top_train[1], len(samples))
            if top_train
            else None
        ),
    }


def daily_train_stats(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stats = aggregate_train_stats(samples)
    return sorted(
        (
            train_stat_response(train_number, stat, len(samples))
            for train_number, stat in stats.items()
        ),
        key=lambda item: (
            -item["peakCongestion"],
            -item["averageCongestion"],
            item["trainNumber"],
        ),
    )


def aggregate_train_stats(
    samples: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    for sample in samples:
        for train_number, congestion in sample["trainTotals"].items():
            stat = stats.setdefault(
                train_number,
                {
                    "sum": Decimal(0),
                    "observedSampleCount": 0,
                    "peak": Decimal(-1),
                    "peakCollectedAt": sample["collectedAt"],
                },
            )
            stat["sum"] += congestion
            stat["observedSampleCount"] += 1
            if congestion >= stat["peak"]:
                stat["peak"] = congestion
                stat["peakCollectedAt"] = sample["collectedAt"]
    return stats


def train_stat_response(
    train_number: str,
    stat: dict[str, Any],
    total_sample_count: int,
) -> dict[str, Any]:
    return {
        "trainNumber": train_number,
        "observedSampleCount": stat["observedSampleCount"],
        "averageCongestion": average_for_response(
            stat["sum"], stat["observedSampleCount"]
        ),
        "dailyAverageContribution": average_for_response(
            stat["sum"], total_sample_count
        ),
        "peakCongestion": number_for_response(stat["peak"]),
        "peakCollectedAt": stat["peakCollectedAt"],
    }


def query_daily_congestion_peak(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    analysis = query_daily_congestion_analysis(
        dynamodb_client,
        summary_table,
        service_date,
    )
    return {
        "serviceDate": analysis["serviceDate"],
        "sampleCount": analysis["sampleCount"],
        "peak": analysis["peak"],
    }
