from __future__ import annotations

from typing import Any

from request_contract import RequestError


JOURNEY_SEARCH_CONTRACT_VERSION = "journey-search-v1"


def validate_request(value: dict[str, Any]) -> None:
    if value.get("contractVersion") != JOURNEY_SEARCH_CONTRACT_VERSION:
        raise RequestError(400, "journey_searchの契約versionが不正です。")


def response(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "contractVersion": JOURNEY_SEARCH_CONTRACT_VERSION,
        **value,
    }
