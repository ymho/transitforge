from tests.services.agent_api.support import *

import journey_search_contract


class JourneySearchContractTest(unittest.TestCase):

    def test_accepts_the_current_contract_version(self) -> None:
        journey_search_contract.validate_request({
            "contractVersion": journey_search_contract.JOURNEY_SEARCH_CONTRACT_VERSION,
        })

    def test_rejects_a_missing_or_unknown_contract_version(self) -> None:
        for value in ({}, {"contractVersion": "journey-search-v2"}):
            with self.subTest(value=value):
                with self.assertRaises(handler.RequestError) as raised:
                    journey_search_contract.validate_request(value)
                self.assertEqual(raised.exception.status_code, 400)

    def test_marks_responses_with_the_current_contract_version(self) -> None:
        self.assertEqual(
            journey_search_contract.response({"journeys": []}),
            {
                "contractVersion": "journey-search-v1",
                "journeys": [],
            },
        )
