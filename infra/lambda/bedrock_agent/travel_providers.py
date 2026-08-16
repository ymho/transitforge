from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence


@dataclass(frozen=True)
class TravelProviderSearch:
    destination: str
    start_date: str
    end_date: str
    adults: int
    limit: int


@dataclass(frozen=True)
class TravelProviderPrice:
    amount: int
    currency: str = "JPY"


@dataclass(frozen=True)
class AccommodationOffering:
    provider: str
    provider_item_id: str
    name: str
    check_in_date: str
    check_out_date: str
    price: TravelProviderPrice | None = None
    booking_url: str | None = None
    area_name: str | None = None

    def as_response(self) -> dict[str, object]:
        return {
            "kind": "accommodation",
            "provider": self.provider,
            "providerItemId": self.provider_item_id,
            "name": self.name,
            "checkInDate": self.check_in_date,
            "checkOutDate": self.check_out_date,
            **price_response(self.price),
            **optional_response("bookingUrl", self.booking_url),
            **optional_response("areaName", self.area_name),
        }


@dataclass(frozen=True)
class ExperienceOffering:
    provider: str
    provider_item_id: str
    name: str
    start_date: str
    price: TravelProviderPrice | None = None
    booking_url: str | None = None
    area_name: str | None = None

    def as_response(self) -> dict[str, object]:
        return {
            "kind": "experience",
            "provider": self.provider,
            "providerItemId": self.provider_item_id,
            "name": self.name,
            "startDate": self.start_date,
            **price_response(self.price),
            **optional_response("bookingUrl", self.booking_url),
            **optional_response("areaName", self.area_name),
        }


class AccommodationProvider(Protocol):
    provider_name: str

    def search_accommodations(
        self,
        request: TravelProviderSearch,
    ) -> Sequence[AccommodationOffering]: ...


class ExperienceProvider(Protocol):
    provider_name: str

    def search_experiences(
        self,
        request: TravelProviderSearch,
    ) -> Sequence[ExperienceOffering]: ...


def price_response(price: TravelProviderPrice | None) -> dict[str, object]:
    if price is None:
        return {}
    if price.currency != "JPY":
        raise ValueError("旅行費用は日本円だけを受け付けます。")
    if not isinstance(price.amount, int) or isinstance(price.amount, bool) or price.amount < 0:
        raise ValueError("旅行費用は0以上の整数円で指定してください。")
    return {"price": {"amount": price.amount, "currency": price.currency}}


def optional_response(key: str, value: str | None) -> dict[str, str]:
    return {} if value is None else {key: value}
