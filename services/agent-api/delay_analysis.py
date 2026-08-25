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


def query_train_delay_analysis(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    validate_service_date(service_date)
    samples = sorted(
        (
            sample
            for item in query_operating_day_summary_items(
                dynamodb_client, summary_table, service_date
            )
            if (sample := delay_sample(item)) is not None
        ),
        key=lambda sample: sample["collectedAt"],
    )
    if not samples:
        return {
            "serviceDate": service_date,
            "sampleCount": 0,
            "observationStart": None,
            "observationEnd": None,
            "latest": None,
            "peak": None,
            "hourly": [empty_delay_hour(hour) for hour in range(24)],
            "trainStats": [],
        }

    peak = max(
        samples,
        key=lambda sample: (
            sample["delayedTrainCount"],
            sample["totalDelayMinutes"],
            sample["collectedAt"],
        ),
    )
    return {
        "serviceDate": service_date,
        "sampleCount": len(samples),
        "observationStart": samples[0]["collectedAt"],
        "observationEnd": samples[-1]["collectedAt"],
        "latest": delay_snapshot_response(samples[-1]),
        "peak": delay_snapshot_response(peak),
        "hourly": delay_hourly_analysis(samples),
        "trainStats": daily_delay_train_stats(samples),
    }


def delay_sample(item: dict[str, Any]) -> dict[str, Any] | None:
    collected_at = dynamo_string(item.get("collectedAt"))
    if collected_at is None:
        return None
    try:
        parsed_collected_at = datetime.fromisoformat(collected_at)
    except ValueError:
        return None
    if parsed_collected_at.tzinfo is None:
        return None
    return {
        "collectedAt": collected_at,
        "hourJst": parsed_collected_at.astimezone(JST).hour,
        "sourceCount": dynamo_number(item.get("sourceCount")),
        "failureCount": dynamo_number(item.get("failureCount")),
        "observedTrainCount": dynamo_number(item.get("observedTrainCount")),
        "delayedTrainCount": dynamo_number(item.get("delayedTrainCount")),
        "totalDelayMinutes": dynamo_number(item.get("totalDelayMinutes")),
        "maximumDelayMinutes": dynamo_number(item.get("maximumDelayMinutes")),
        "trainDelays": dynamo_number_map(item.get("trainDelays")),
    }


def delay_snapshot_response(sample: dict[str, Any]) -> dict[str, Any]:
    top_trains = sorted(
        (
            {
                "trainNumber": train_number,
                "delayMinutes": number_for_response(delay),
            }
            for train_number, delay in sample["trainDelays"].items()
        ),
        key=lambda train: (-train["delayMinutes"], train["trainNumber"]),
    )[:10]
    return {
        "collectedAt": sample["collectedAt"],
        "sourceCount": int(sample["sourceCount"]),
        "failureCount": int(sample["failureCount"]),
        "observedTrainCount": int(sample["observedTrainCount"]),
        "delayedTrainCount": int(sample["delayedTrainCount"]),
        "totalDelayMinutes": number_for_response(sample["totalDelayMinutes"]),
        "maximumDelayMinutes": number_for_response(sample["maximumDelayMinutes"]),
        "topTrains": top_trains,
    }


def empty_delay_hour(hour: int) -> dict[str, Any]:
    return {
        "hourJst": hour,
        "sampleCount": 0,
        "averageDelayedTrainCount": None,
        "peakDelayedTrainCount": None,
        "peakTotalDelayMinutes": None,
        "maximumDelayMinutes": None,
        "peakCollectedAt": None,
    }


def delay_hourly_analysis(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples_by_hour: list[list[dict[str, Any]]] = [[] for _ in range(24)]
    for sample in samples:
        samples_by_hour[sample["hourJst"]].append(sample)

    result: list[dict[str, Any]] = []
    for hour, hour_samples in enumerate(samples_by_hour):
        if not hour_samples:
            result.append(empty_delay_hour(hour))
            continue
        peak = max(
            hour_samples,
            key=lambda sample: (
                sample["delayedTrainCount"],
                sample["totalDelayMinutes"],
                sample["collectedAt"],
            ),
        )
        result.append(
            {
                "hourJst": hour,
                "sampleCount": len(hour_samples),
                "averageDelayedTrainCount": average_for_response(
                    sum(
                        (sample["delayedTrainCount"] for sample in hour_samples),
                        Decimal(0),
                    ),
                    len(hour_samples),
                ),
                "peakDelayedTrainCount": int(peak["delayedTrainCount"]),
                "peakTotalDelayMinutes": number_for_response(
                    peak["totalDelayMinutes"]
                ),
                "maximumDelayMinutes": number_for_response(
                    max(sample["maximumDelayMinutes"] for sample in hour_samples)
                ),
                "peakCollectedAt": peak["collectedAt"],
            }
        )
    return result


def daily_delay_train_stats(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    for sample in samples:
        for train_number, delay in sample["trainDelays"].items():
            stat = stats.setdefault(
                train_number,
                {
                    "sum": Decimal(0),
                    "delayedSampleCount": 0,
                    "peak": Decimal(-1),
                    "peakCollectedAt": sample["collectedAt"],
                },
            )
            stat["sum"] += delay
            stat["delayedSampleCount"] += 1
            if delay >= stat["peak"]:
                stat["peak"] = delay
                stat["peakCollectedAt"] = sample["collectedAt"]

    return sorted(
        (
            {
                "trainNumber": train_number,
                "delayedSampleCount": stat["delayedSampleCount"],
                "averageDelayWhenDelayed": average_for_response(
                    stat["sum"], stat["delayedSampleCount"]
                ),
                "dailyAverageDelayContribution": average_for_response(
                    stat["sum"], len(samples)
                ),
                "peakDelayMinutes": number_for_response(stat["peak"]),
                "peakCollectedAt": stat["peakCollectedAt"],
            }
            for train_number, stat in stats.items()
        ),
        key=lambda train: (
            -train["peakDelayMinutes"],
            -train["delayedSampleCount"],
            train["trainNumber"],
        ),
    )
