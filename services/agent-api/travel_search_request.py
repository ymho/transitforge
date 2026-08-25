from __future__ import annotations

from datetime import date
from typing import Any

from request_contract import RequestError
from domain.travel.models import TravelProviderSearch


MAX_DESTINATION_LENGTH = 80
MAX_ADULTS = 10
MAX_LIMIT = 5
MAX_STAY_NIGHTS = 31


def provider_search_from(value: dict[str, Any]) -> TravelProviderSearch:
    destination = value.get("destination")
    check_in_date = value.get("checkInDate")
    check_out_date = value.get("checkOutDate")
    adults = value.get("adults", 1)
    limit = value.get("limit", 3)

    if not isinstance(destination, str) or not destination.strip():
        raise RequestError(400, "destinationが必要です。")
    normalized_destination = destination.strip()
    if len(normalized_destination) > MAX_DESTINATION_LENGTH:
        raise RequestError(400, "destinationが長すぎます。")
    check_in = _calendar_date(check_in_date, "checkInDate")
    check_out = _calendar_date(check_out_date, "checkOutDate")
    if check_out <= check_in:
        raise RequestError(400, "checkOutDateはcheckInDateより後にしてください。")
    if (check_out - check_in).days > MAX_STAY_NIGHTS:
        raise RequestError(400, "宿泊日数は31泊以下にしてください。")
    if not _bounded_integer(adults, 1, MAX_ADULTS):
        raise RequestError(400, "adultsは1から10にしてください。")
    if not _bounded_integer(limit, 1, MAX_LIMIT):
        raise RequestError(400, "limitは1から5にしてください。")

    return TravelProviderSearch(
        destination=normalized_destination,
        start_date=check_in.isoformat(),
        end_date=check_out.isoformat(),
        adults=adults,
        limit=limit,
    )


def _calendar_date(value: Any, field: str) -> date:
    if not isinstance(value, str):
        raise RequestError(400, f"{field}が必要です。")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise RequestError(400, f"{field}はYYYY-MM-DD形式にしてください。") from error


def _bounded_integer(value: Any, minimum: int, maximum: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum
