from tests.agent_api_test_support import *

import travel_candidate_assembly
import travel_providers


class TravelCandidateAssemblyTest(unittest.TestCase):
    def test_assembles_an_explicit_package_without_adding_rail_fare(self) -> None:
        candidate = travel_candidate_assembly.assemble(
            travel_candidate_assembly.TravelCandidateSelection(
                candidate_id="candidate-1",
                journey={"departureTimeMinutes": 420, "arrivalTimeMinutes": 660, "legs": []},
                accommodations=[travel_providers.AccommodationOffering(
                    provider="example-provider",
                    provider_item_id="stay-1",
                    name="出雲の宿",
                    check_in_date="2026-08-16",
                    check_out_date="2026-08-17",
                    price=travel_providers.TravelProviderPrice(amount=12000),
                )],
                experiences=[travel_providers.ExperienceOffering(
                    provider="example-provider",
                    provider_item_id="experience-1",
                    name="街歩き",
                    start_date="2026-08-17",
                    price=travel_providers.TravelProviderPrice(amount=2500),
                )],
            )
        )

        self.assertEqual(candidate["expenseSummary"], {
            "currency": "JPY",
            "accommodationAmount": 12000,
            "experienceAmount": 2500,
            "knownTotalAmount": 14500,
            "pricedItemCount": 2,
            "hasUnpricedItems": False,
            "excludesRailFare": True,
        })

    def test_keeps_an_unpriced_offering_out_of_the_total(self) -> None:
        candidate = travel_candidate_assembly.assemble(
            travel_candidate_assembly.TravelCandidateSelection(
                candidate_id="candidate-1",
                journey={},
                experiences=[travel_providers.ExperienceOffering(
                    provider="example-provider",
                    provider_item_id="experience-1",
                    name="街歩き",
                    start_date="2026-08-17",
                )],
            )
        )

        self.assertEqual(candidate["expenseSummary"]["knownTotalAmount"], 0)
        self.assertTrue(candidate["expenseSummary"]["hasUnpricedItems"])
