from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import journey_search
import representative_timetable
import travel_provider_accommodation
import travel_provider_credentials
import travel_search_request
from congestion_analysis import (
    query_daily_congestion_analysis,
    query_daily_congestion_peak,
)
from delay_analysis import query_train_delay_analysis
from request_contract import RequestError


HANDLED_OPERATIONS = frozenset(
    {
        "representative_timetable_search",
        "journey_search",
        "daily_congestion_analysis",
        "daily_congestion_peak",
        "train_delay_analysis",
        "travel_accommodation_search",
    }
)


@dataclass(frozen=True)
class OperationConfig:
    summary_table: str
    delay_summary_table: str
    timetable_bucket: str
    timetable_prefix: str
    planning_timetable_prefix: str
    traffic_snapshot_bucket: str
    traffic_snapshot_key: str
    travel_provider_secret_arn: str


def handles(value: dict[str, Any]) -> bool:
    return value.get("operation") in HANDLED_OPERATIONS


def dispatch(
    value: dict[str, Any],
    config: OperationConfig,
    s3_client: Callable[[], Any],
    dynamodb_client: Callable[[], Any],
    secrets_manager_client: Callable[[], Any] | None = None,
    http_opener: Callable[..., Any] | None = None,
) -> dict[str, Any] | None:
    operation = value.get("operation")
    if operation == "representative_timetable_search":
        try:
            return representative_timetable.search(
                s3_client(),
                config.timetable_bucket,
                config.timetable_prefix,
                value,
            )
        except representative_timetable.TimetableSearchError as error:
            raise RequestError(400, str(error)) from error
    if operation == "journey_search":
        try:
            return journey_search.search(
                s3_client(),
                bucket=config.timetable_bucket,
                prefix=config.planning_timetable_prefix,
                snapshot_bucket=config.traffic_snapshot_bucket,
                snapshot_key=config.traffic_snapshot_key,
                value=value,
            )
        except RequestError:
            raise
        except Exception as error:
            raise RequestError(503, "旅行候補を検索できません。") from error
    if operation == "travel_accommodation_search":
        if secrets_manager_client is None:
            raise RequestError(503, "宿泊提供者の設定を読み取れません。")
        try:
            request = travel_search_request.provider_search_from(value)
            credentials = travel_provider_credentials.load_travel_provider_credentials(
                config.travel_provider_secret_arn, secrets_manager_client()
            )
            offerings = travel_provider_accommodation.search_accommodations(
                request, credentials, opener=http_opener or travel_provider_accommodation.urlopen
            )
            return {"accommodations": [offering.as_response() for offering in offerings]}
        except ValueError as error:
            raise RequestError(503, str(error)) from error
    if operation not in HANDLED_OPERATIONS:
        return None

    service_date = value.get("serviceDate")
    if not isinstance(service_date, str):
        raise RequestError(400, "serviceDateが必要です。")
    if operation == "train_delay_analysis":
        query = query_train_delay_analysis
        table = config.delay_summary_table
    elif operation == "daily_congestion_analysis":
        query = query_daily_congestion_analysis
        table = config.summary_table
    else:
        query = query_daily_congestion_peak
        table = config.summary_table
    return query(dynamodb_client(), table, service_date)
