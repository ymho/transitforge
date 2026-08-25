from tests.services.agent_api.support import *

import travel_search_request
from request_contract import RequestError


class TravelSearchRequestTest(unittest.TestCase):
    def test_normalizes_a_bounded_provider_search_request(self) -> None:
        request = travel_search_request.provider_search_from({
            "destination": " 出雲市 ",
            "checkInDate": "2026-08-16",
            "checkOutDate": "2026-08-18",
            "adults": 2,
            "limit": 3,
        })

        self.assertEqual(request.destination, "出雲市")
        self.assertEqual(request.start_date, "2026-08-16")
        self.assertEqual(request.end_date, "2026-08-18")
        self.assertEqual(request.adults, 2)

    def test_rejects_invalid_dates_and_unbounded_values(self) -> None:
        invalid_values = [
            {"destination": "出雲市", "checkInDate": "2026-08-18", "checkOutDate": "2026-08-16"},
            {"destination": "出雲市", "checkInDate": "2026-08-16", "checkOutDate": "2026-09-18"},
            {"destination": "出雲市", "checkInDate": "2026-08-16", "checkOutDate": "2026-08-17", "adults": 0},
            {"destination": "出雲市", "checkInDate": "2026-08-16", "checkOutDate": "2026-08-17", "limit": 6},
        ]

        for value in invalid_values:
            with self.assertRaises(RequestError):
                travel_search_request.provider_search_from(value)
