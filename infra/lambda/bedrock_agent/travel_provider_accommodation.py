from __future__ import annotations

import json
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
    try:
        with opener(http_request, timeout=8) as response:
            value = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        raise ValueError("宿泊提供者の検索を利用できません。") from error
    return _offerings(value, request)


def _offerings(value: Any, request: TravelProviderSearch) -> list[AccommodationOffering]:
    if not isinstance(value, dict):
        raise ValueError("宿泊提供者の応答を読み取れません。")
    hotels = value.get("hotels")
    if not isinstance(hotels, list):
        return []
    offerings: list[AccommodationOffering] = []
    for hotel in hotels[: request.limit]:
        basic = hotel.get("hotelBasicInfo") if isinstance(hotel, dict) else None
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
        ))
    return offerings


def _optional_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
