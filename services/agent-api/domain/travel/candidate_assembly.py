from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from domain.travel.models import AccommodationOffering, ExperienceOffering


@dataclass(frozen=True)
class TravelCandidateSelection:
    candidate_id: str
    journey: dict[str, Any]
    accommodations: Sequence[AccommodationOffering] = ()
    experiences: Sequence[ExperienceOffering] = ()


def assemble(selection: TravelCandidateSelection) -> dict[str, object]:
    accommodations = [offering.as_response() for offering in selection.accommodations]
    experiences = [offering.as_response() for offering in selection.experiences]
    summary = _expense_summary([*accommodations, *experiences])
    return {
        "id": selection.candidate_id,
        "journey": selection.journey,
        "accommodations": accommodations,
        "experiences": experiences,
        "expenseSummary": summary,
    }


def _expense_summary(offerings: Sequence[dict[str, object]]) -> dict[str, object]:
    accommodation_amount = 0
    experience_amount = 0
    priced_item_count = 0
    has_unpriced_items = False

    for offering in offerings:
        price = offering.get("price")
        if not isinstance(price, dict):
            has_unpriced_items = True
            continue
        amount = price.get("amount")
        if not isinstance(amount, int) or isinstance(amount, bool):
            raise ValueError("旅行費用は0以上の整数円で指定してください。")
        if offering.get("kind") == "accommodation":
            accommodation_amount += amount
        elif offering.get("kind") == "experience":
            experience_amount += amount
        priced_item_count += 1

    return {
        "currency": "JPY",
        "accommodationAmount": accommodation_amount,
        "experienceAmount": experience_amount,
        "knownTotalAmount": accommodation_amount + experience_amount,
        "pricedItemCount": priced_item_count,
        "hasUnpricedItems": has_unpriced_items,
        "excludesRailFare": True,
    }
