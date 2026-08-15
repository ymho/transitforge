"""Deterministic journey constraints shared by search strategies."""
from __future__ import annotations

import re
import unicodedata
from typing import Any


EXCLUSION_FIELDS = (
    "excludedServiceTypes",
    "excludedTrainNames",
    "excludedTrainNumbers",
    "excludedServiceUids",
)
REQUIREMENT_FIELDS = (
    "requiredServiceTypes",
    "requiredTrainNames",
    "requiredTrainNumbers",
)
CONSTRAINT_FIELDS = (*EXCLUSION_FIELDS, *REQUIREMENT_FIELDS, "allowedServiceTypes")


def eligible_service_ids(
    services: dict[str, Any], request: dict[str, Any]
) -> set[str]:
    allowed_types = _values(request, "allowedServiceTypes")
    return {
        str(service_id)
        for service_id, service in services.items()
        if isinstance(service, dict)
        and not is_service_excluded(service, request)
        and (
            not allowed_types
            or _service_value(service, "serviceType") in allowed_types
        )
    }


def is_service_excluded(service: dict[str, Any], request: dict[str, Any]) -> bool:
    return any(
        _service_matches(service, field, value)
        for field in EXCLUSION_FIELDS
        for value in _values(request, field)
    )


def service_requirement_mask(
    service: dict[str, Any], request: dict[str, Any]
) -> int:
    mask = 0
    for index, (field, value) in enumerate(_requirement_tokens(request)):
        if _service_matches(service, field, value):
            mask |= 1 << index
    return mask


def required_requirement_mask(request: dict[str, Any]) -> int:
    return (1 << len(_requirement_tokens(request))) - 1


def journey_satisfies_requirements(
    legs: list[dict[str, Any]], request: dict[str, Any]
) -> bool:
    actual = 0
    for leg in legs:
        actual |= service_requirement_mask(leg, request)
    return actual == required_requirement_mask(request)


def response_constraints(request: dict[str, Any]) -> dict[str, list[str]]:
    return {
        field: list(request.get(field) or [])
        for field in CONSTRAINT_FIELDS
    }


def trace_constraints(request: dict[str, Any]) -> dict[str, list[str]]:
    return {
        field: sorted(_values(request, field))
        for field in CONSTRAINT_FIELDS
    }


def _requirement_tokens(request: dict[str, Any]) -> list[tuple[str, str]]:
    return [
        (field, value)
        for field in REQUIREMENT_FIELDS
        for value in sorted(_values(request, field))
    ]


def _service_matches(service: dict[str, Any], field: str, value: str) -> bool:
    if field.endswith("ServiceTypes"):
        return _service_value(service, "serviceType") == value
    if field.endswith("TrainNumbers"):
        return _service_value(service, "trainNumber") == value
    if field.endswith("ServiceUids"):
        return _service_value(service, "serviceUid") == value
    if field.endswith("TrainNames"):
        return _train_name_matches(_service_value(service, "trainName"), value)
    return False


def _service_value(service: dict[str, Any], field: str) -> str:
    keys = {
        "serviceType": ("service_type", "serviceType"),
        "trainName": ("train_name", "trainName"),
        "trainNumber": ("train_no", "trainNumber"),
        "serviceUid": ("service_uid", "serviceUid"),
    }[field]
    return next(
        (_normalize(service.get(key)) for key in keys if service.get(key) is not None),
        "",
    )


def _train_name_matches(train_name: str, requested: str) -> bool:
    if not train_name or not requested:
        return False
    if re.search(r"[0-9]+号$", requested):
        return train_name == requested
    return re.sub(r"[0-9]+号$", "", train_name) == requested


def _values(request: dict[str, Any], field: str) -> set[str]:
    return {
        normalized
        for value in request.get(field) or []
        if (normalized := _normalize(value))
    }


def _normalize(value: Any) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))
