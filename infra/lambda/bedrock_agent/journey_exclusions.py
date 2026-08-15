"""Deterministic train exclusions shared by journey search strategies."""
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


def excluded_service_ids(
    services: dict[str, Any], request: dict[str, Any]
) -> set[str]:
    return {
        str(service_id)
        for service_id, service in services.items()
        if isinstance(service, dict) and is_service_excluded(service, request)
    }


def is_service_excluded(service: dict[str, Any], request: dict[str, Any]) -> bool:
    service_type = _normalize(service.get("service_type"))
    train_name = _normalize(service.get("train_name"))
    train_number = _normalize(service.get("train_no"))
    service_uid = _normalize(service.get("service_uid"))
    if service_type in _values(request, "excludedServiceTypes"):
        return True
    if train_number in _values(request, "excludedTrainNumbers"):
        return True
    if service_uid in _values(request, "excludedServiceUids"):
        return True
    return any(
        _train_name_matches(train_name, excluded)
        for excluded in _values(request, "excludedTrainNames")
    )


def response_exclusions(request: dict[str, Any]) -> dict[str, list[str]]:
    return {
        field: list(request.get(field) or [])
        for field in EXCLUSION_FIELDS
    }


def trace_exclusions(request: dict[str, Any]) -> dict[str, list[str]]:
    return {
        field: sorted(_values(request, field))
        for field in EXCLUSION_FIELDS
    }


def _train_name_matches(train_name: str, excluded: str) -> bool:
    if not train_name or not excluded:
        return False
    if re.search(r"[0-9]+号$", excluded):
        return train_name == excluded
    return re.sub(r"[0-9]+号$", "", train_name) == excluded


def _values(request: dict[str, Any], field: str) -> set[str]:
    return {
        normalized
        for value in request.get(field) or []
        if (normalized := _normalize(value))
    }


def _normalize(value: Any) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))
