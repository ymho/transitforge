from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any

from request_contract import RequestError

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_service_date(service_date: str) -> None:
    if not DATE_PATTERN.fullmatch(service_date):
        raise RequestError(400, "serviceDateはYYYY-MM-DD形式にしてください。")
    try:
        parsed_date = datetime.strptime(service_date, "%Y-%m-%d")
    except ValueError as error:
        raise RequestError(400, "serviceDateが実在する日付ではありません。") from error
    if parsed_date.strftime("%Y-%m-%d") != service_date:
        raise RequestError(400, "serviceDateが不正です。")


def query_daily_summary_items(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    exclusive_start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "TableName": summary_table,
            "KeyConditionExpression": "serviceDate = :service_date",
            "ExpressionAttributeValues": {":service_date": {"S": service_date}},
        }
        if exclusive_start_key:
            request["ExclusiveStartKey"] = exclusive_start_key
        result = dynamodb_client.query(**request)
        items.extend(result.get("Items", []))
        exclusive_start_key = result.get("LastEvaluatedKey")
        if not exclusive_start_key:
            return items


def dynamo_number(value: Any) -> Decimal:
    if not isinstance(value, dict) or not isinstance(value.get("N"), str):
        return Decimal(0)
    return Decimal(value["N"])


def dynamo_string(value: Any) -> str | None:
    if not isinstance(value, dict) or not isinstance(value.get("S"), str):
        return None
    return value["S"]


def dynamo_number_map(value: Any) -> dict[str, Decimal]:
    if not isinstance(value, dict) or not isinstance(value.get("M"), dict):
        return {}
    return {
        key: dynamo_number(raw_value)
        for key, raw_value in value["M"].items()
        if isinstance(key, str)
    }


def number_for_response(value: Decimal) -> int | float:
    integral = value.to_integral_value()
    return int(integral) if value == integral else float(value)


def average_for_response(total: Decimal, count: int) -> int | float:
    if count <= 0:
        return 0
    return number_for_response((total / Decimal(count)).quantize(Decimal("0.01")))
