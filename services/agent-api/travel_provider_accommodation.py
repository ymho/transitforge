from __future__ import annotations

import json
import time
from typing import Any, Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from travel_provider_credentials import TravelProviderCredentials
from travel_providers import AccommodationOffering, TravelProviderSearch


class HttpResponse(Protocol):
    def read(self) -> bytes: ...

    def __enter__(self) -> "HttpResponse": ...

    def __exit__(self, *args: object) -> None: ...


def search_accommodations(
    request: TravelProviderSearch,
    credentials: TravelProviderCredentials,
    opener: Any = urlopen,
    request_id: str | None = None,
    log_event: Any = None,
) -> list[AccommodationOffering]:
    query = {
        "applicationId": credentials.application_id,
        "format": "json",
        "formatVersion": "2",
        "keyword": request.destination,
        "hits": str(request.limit),
    }
    if credentials.affiliate_id:
        query["affiliateId"] = credentials.affiliate_id
    http_request = Request(
        f"{credentials.hotel_search_url}?{urlencode(query)}",
        headers={"accessKey": credentials.access_key, "Accept": "application/json"},
    )
    started = time.perf_counter()
    if log_event and request_id:
        log_event("travel_provider_request_started", request_id)
    try:
        with opener(http_request, timeout=8) as response:
            value = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        if log_event and request_id:
            log_event("travel_provider_request_failed", request_id, durationMs=round((time.perf_counter() - started) * 1000), errorType=type(error).__name__)
        raise ValueError("宿泊提供者の検索を利用できません。") from error
    offerings = _offerings(value, request)
    if log_event and request_id:
        log_event(
            "travel_provider_request_completed",
            request_id,
            durationMs=round((time.perf_counter() - started) * 1000),
            resultCount=len(offerings),
        )
    return offerings


def _offerings(value: Any, request: TravelProviderSearch) -> list[AccommodationOffering]:
    if not isinstance(value, dict):
        raise ValueError("宿泊提供者の応答を読み取れません。")
    hotels = value.get("hotels")
    if not isinstance(hotels, list):
        return []
    offerings: list[AccommodationOffering] = []
    for hotel in hotels[: request.limit]:
        basic = _hotel_basic_info(hotel)
        if not isinstance(basic, dict):
            continue
        hotel_id = basic.get("hotelNo")
        name = basic.get("hotelName")
        if not isinstance(hotel_id, int) or not isinstance(name, str) or not name.strip():
            continue
        offerings.append(AccommodationOffering(
            provider="travel-provider",
            provider_item_id=str(hotel_id),
            name=name.strip(),
            check_in_date=request.start_date,
            check_out_date=request.end_date,
            booking_url=_optional_string(basic.get("hotelInformationUrl")),
            area_name=_optional_string(basic.get("address1")),
            image_url=_optional_https_url(basic.get("hotelImageUrl")),
        ))
    return offerings


def _hotel_basic_info(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        basic = value.get("hotelBasicInfo")
        return basic if isinstance(basic, dict) else None
    if not isinstance(value, list):
        return None
    for item in value:
        basic = _hotel_basic_info(item)
        if basic is not None:
            return basic
    return None


def _optional_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_https_url(value: Any) -> str | None:
    value = _optional_string(value)
    return value if value and value.startswith("https://") else None
