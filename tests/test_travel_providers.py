from tests.agent_api_test_support import *

import travel_providers


class TravelProviderContractTest(unittest.TestCase):
    def test_accommodation_response_uses_the_provider_independent_contract(self) -> None:
        offering = travel_providers.AccommodationOffering(
            provider="example-provider",
            provider_item_id="stay-1",
            name="出雲の宿",
            check_in_date="2026-08-16",
            check_out_date="2026-08-17",
            area_name="出雲市",
            price=travel_providers.TravelProviderPrice(amount=12000),
        )

        self.assertEqual(
            offering.as_response(),
            {
                "kind": "accommodation",
                "provider": "example-provider",
                "providerItemId": "stay-1",
                "name": "出雲の宿",
                "checkInDate": "2026-08-16",
                "checkOutDate": "2026-08-17",
                "areaName": "出雲市",
                "price": {"amount": 12000, "currency": "JPY"},
            },
        )

    def test_price_unknown_is_not_replaced_with_an_estimate(self) -> None:
        offering = travel_providers.ExperienceOffering(
            provider="example-provider",
            provider_item_id="experience-1",
            name="街歩き",
            start_date="2026-08-17",
        )

        self.assertNotIn("price", offering.as_response())

    def test_rejects_non_jpy_and_invalid_prices(self) -> None:
        with self.assertRaisesRegex(ValueError, "日本円"):
            travel_providers.price_response(
                travel_providers.TravelProviderPrice(amount=10, currency="USD")
            )
        with self.assertRaisesRegex(ValueError, "0以上の整数円"):
            travel_providers.price_response(
                travel_providers.TravelProviderPrice(amount=-1)
            )
