"""Shared realtime operation correction for journey search strategies."""
from __future__ import annotations

from decimal import Decimal
from typing import Any


def operation_for(
    service: dict[str, Any], operations: dict[str, dict[str, Any]] | None,
) -> dict[str, Any] | None:
    if operations is None:
        return None
    train_number = str(service.get("train_no") or "")
    operation = operations.get(train_number)
    if operation is not None:
        return operation
    if "関空快速" not in str(service.get("service_type") or ""):
        return None
    if train_number.endswith("M"):
        alias = operations.get(train_number[:-1])
        if alias is not None and "osakaloop" in alias.get("sources", []):
            return alias
    return None


def delay_info(
    service_id: str,
    service: dict[str, Any],
    delays: dict[str, Decimal],
    operations: dict[str, dict[str, Any]] | None,
    predictions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    predicted = predictions.get(service_id)
    if predicted is not None:
        return predicted
    operation = operation_for(service, operations)
    delay = (
        float(operation["delayMinutes"])
        if operation is not None
        else float(max(Decimal(0), delays.get(str(service.get("train_no") or ""), Decimal(0))))
    )
    return {"delayMinutes": delay, **({"delayStatus": "observed"} if delay > 0 else {})}


def service_destination(service: dict[str, Any], operations: dict[str, dict[str, Any]] | None) -> str:
    operation = operation_for(service, operations)
    if (
        operation is not None
        and "osakaloop" not in operation.get("sources", [])
        and operation.get("destination")
    ):
        return str(operation["destination"])
    return str(service.get("destination_station") or "")


def effective_calls(
    service: dict[str, Any], operations: dict[str, dict[str, Any]] | None,
    normalize: Any,
) -> list[dict[str, Any]]:
    raw = service.get("calls")
    calls = [call for call in raw if isinstance(call, dict)] if isinstance(raw, list) else []
    operation = operation_for(service, operations)
    if operation is None or "osakaloop" in operation.get("sources", []):
        return calls
    destination = normalize(operation.get("destination"))
    scheduled = normalize(service.get("destination_station"))
    if not destination or destination == scheduled:
        return calls
    index = next((
        index for index, call in enumerate(calls[1:-1], start=1)
        if normalize(call.get("station_name")) == destination
    ), None)
    return calls[:index + 1] if index is not None else calls
