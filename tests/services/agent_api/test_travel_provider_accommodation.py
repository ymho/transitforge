from tests.services.agent_api.support import *

from travel_provider_accommodation import search_accommodations
from travel_provider_credentials import TravelProviderCredentials
from domain.travel.models import TravelProviderSearch


class FakeResponse:
    def __init__(self, value: dict[str, object]) -> None:
        self.value = value

    def read(self) -> bytes:
        return json.dumps(self.value).encode("utf-8")

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None


class TravelProviderAccommodationTest(unittest.TestCase):
    def test_normalizes_hotel_results_without_using_an_undated_price(self) -> None:
        requests = []

        def opener(request: object, timeout: int) -> FakeResponse:
            requests.append((request, timeout))
            return FakeResponse({"hotels": [[{"hotelBasicInfo": {
                "hotelNo": 42,
                "hotelName": "駅前の宿",
                "hotelInformationUrl": "https://booking.example/42",
                "hotelImageUrl": "https://images.example/42.jpg",
                "address1": "出雲市",
            }}]]})

        offerings = search_accommodations(
            TravelProviderSearch("出雲市", "2026-08-17", "2026-08-18", 1, 3),
            TravelProviderCredentials("app", "secret", "https://provider.example/search"),
            opener,
        )

        self.assertEqual(len(offerings), 1)
        self.assertEqual(offerings[0].provider_item_id, "42")
        self.assertIsNone(offerings[0].price)
        self.assertEqual(offerings[0].image_url, "https://images.example/42.jpg")
        request, timeout = requests[0]
        self.assertEqual(timeout, 8)
        self.assertEqual(request.headers["Accesskey"], "secret")
        self.assertIn("applicationId=app", request.full_url)
        self.assertIn("keyword=%E5%87%BA%E9%9B%B2%E5%B8%82", request.full_url)
