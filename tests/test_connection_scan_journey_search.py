from tests.bedrock_agent_test_support import *

class ConnectionScanJourneySearchTest(unittest.TestCase):

    def test_connection_scan_applies_delay_and_returns_readable_trace(self) -> None:
        index = connection_index_fixture()
        result = handler.journey_search.search_index(
            index,
            {"538C": Decimal(5)},
            {
                "serviceDate": "2026-08-14", "originStation": "西大路",
                "destinationStation": "京都", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
        )

        self.assertEqual(result["totalMatchCount"], 1)
        self.assertEqual(result["matches"][0]["departureTimeMinutes"], 605)
        self.assertEqual(result["matches"][0]["arrivalTimeMinutes"], 613)
        self.assertEqual(result["matches"][0]["discoverySource"], "timetable-graph")
        self.assertGreater(result["trace"]["connectionsScanned"], 0)
        self.assertEqual(result["trace"]["selectedJourneys"][0]["trips"], ["trip-direct"])

    def test_connection_scan_estimates_a_future_train_from_the_same_local_direction(self) -> None:
        index = connection_index_from_legs([
            ("observed", "100M", "姫路", "東姫路", 580, 584),
            ("candidate", "102M", "姫路", "東姫路", 610, 614),
            ("reverse", "200M", "東姫路", "姫路", 605, 609),
        ])
        request = {
            "serviceDate": "2026-08-14", "originStation": "姫路",
            "destinationStation": "東姫路", "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 0, "includeTrace": True,
        }
        result = handler.journey_search.search_index(
            index,
            {},
            request,
            operations={
                "100M": {
                    "delayMinutes": 12, "destination": "東姫路",
                    "sources": ["source-a"],
                },
                "200M": {
                    "delayMinutes": 40, "destination": "姫路",
                    "sources": ["source-a"],
                },
            },
        )

        leg = result["journeys"][0]["legs"][0]
        self.assertEqual(leg["trainNumber"], "102M")
        self.assertEqual(leg["departureTimeMinutes"], 622)
        self.assertEqual(leg["delayMinutes"], 12)
        self.assertEqual(leg["delayStatus"], "estimated")
        self.assertEqual(leg["delayBasis"], "姫路→東姫路")
        self.assertEqual(result["trace"]["estimatedDelayTrips"], 1)

    def test_connection_scan_does_not_estimate_from_reverse_or_remote_trains(self) -> None:
        index = connection_index_from_legs([
            ("remote", "100M", "姫路", "東姫路", 400, 404),
            ("reverse", "200M", "東姫路", "姫路", 605, 609),
            ("candidate", "102M", "姫路", "東姫路", 610, 614),
        ])
        result = handler.journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "姫路",
                "destinationStation": "東姫路", "departureTimeMinutes": 600,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
            operations={
                "100M": {
                    "delayMinutes": 20, "destination": "東姫路",
                    "sources": ["source-a"],
                },
                "200M": {
                    "delayMinutes": 30, "destination": "姫路",
                    "sources": ["source-a"],
                },
            },
        )

        leg = result["journeys"][0]["legs"][0]
        self.assertEqual(leg["departureTimeMinutes"], 610)
        self.assertEqual(leg["delayMinutes"], 0)
        self.assertNotIn("delayStatus", leg)

    def test_connection_scan_allows_one_transfer_only_with_enough_time(self) -> None:
        index = connection_index_fixture()
        request = {
            "serviceDate": "2026-08-14", "originStation": "向日町",
            "destinationStation": "大阪", "departureTimeMinutes": 580.0,
            "limit": 3, "maxTransfers": 1, "includeTrace": True,
        }
        result = handler.journey_search.search_index(index, {}, request)

        self.assertEqual(result["journeys"][0]["transferCount"], 1)
        self.assertEqual(
            [leg["serviceUid"] for leg in result["journeys"][0]["legs"]],
            ["trip-direct", "trip-transfer"],
        )
        self.assertEqual(result["matches"], [])
        self.assertEqual(result["trace"]["stationTransferRulesUsed"], {})

        tight_index = connection_index_fixture()
        tight_index["connections"][2]["departure_time_minutes"] = 612
        tight_result = handler.journey_search.search_index(tight_index, {}, request)
        self.assertEqual(tight_result["journeys"], [])
        self.assertGreater(tight_result["trace"]["labelsRejectedByTransferTime"], 0)

    def test_connection_scan_supports_multiple_transfers_and_transfer_pace(self) -> None:
        request = {
            "serviceDate": "2026-08-14",
            "originStation": "A", "destinationStation": "D",
            "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        result = handler.journey_search.search_index(
            multi_transfer_index_fixture(), {}, request
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 2)
        self.assertEqual(
            [leg["trainNumber"] for leg in result["journeys"][0]["legs"]],
            ["1M", "2M", "3M"],
        )
        self.assertEqual(
            [leg["serviceDestination"] for leg in result["journeys"][0]["legs"]],
            ["B", "C", "D"],
        )

        relaxed = handler.journey_search.search_index(
            multi_transfer_index_fixture(), {},
            {**request, "transferPace": "relaxed"},
        )
        self.assertEqual(relaxed["journeys"], [])

    def test_connection_scan_does_not_transfer_between_same_named_stations(self) -> None:
        request = {
            "serviceDate": "2026-08-14",
            "originStation": "清音", "destinationStation": "出雲市",
            "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        index = connection_index_from_legs([
            ("ibara", "1321D", "清音", "小田", 600, 619),
            ("sanin", "324D", "小田", "出雲市", 641, 661),
        ])

        result = handler.journey_search.search_index(index, {}, request)

        self.assertEqual(result["journeys"], [])
        self.assertGreater(
            result["trace"]["labelsRejectedByNonUniqueStation"], 0
        )

    def test_connection_scan_can_prefer_a_later_departure(self) -> None:
        request = {
            "serviceDate": "2026-08-14",
            "originStation": "A", "destinationStation": "D",
            "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        balanced = handler.journey_search.search_index(
            preference_index_fixture(), {}, request
        )
        latest = handler.journey_search.search_index(
            preference_index_fixture(), {},
            {**request, "rankingPreference": "latest-departure"},
        )

        self.assertEqual(balanced["journeys"][0]["departureTimeMinutes"], 600)
        self.assertEqual(latest["journeys"][0]["departureTimeMinutes"], 615)

    def test_connection_scan_excludes_shinkansen_during_search(self) -> None:
        index = connection_index_from_legs([
            ("shinkansen", "500A", "高槻", "米原", 600, 640),
            ("conventional", "3450M", "高槻", "米原", 605, 680),
        ])
        index["trips"]["shinkansen"]["service_type"] = "新幹線"
        result = handler.journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-15",
                "originStation": "高槻",
                "destinationStation": "米原",
                "departureTimeMinutes": 590,
                "limit": 3,
                "maxTransfers": 3,
                "includeTrace": True,
                "excludedServiceTypes": ["新幹線"],
            },
        )

        self.assertEqual(
            result["journeys"][0]["legs"][0]["trainNumber"], "3450M"
        )
        self.assertEqual(result["excludedServiceTypes"], ["新幹線"])
        self.assertEqual(result["trace"]["excludedTrips"], 1)
        self.assertGreater(
            result["trace"]["excludedServiceConnectionsRejected"], 0
        )

    def test_connection_scan_keeps_a_required_train_when_a_faster_route_exists(self) -> None:
        index = connection_index_from_legs([
            ("fast-local", "100M", "A", "D", 600, 620),
            ("feeder", "101M", "A", "B", 602, 612),
            ("yakumo", "1005M", "B", "D", 620, 650),
        ])
        index["trips"]["yakumo"].update({
            "service_type": "特急",
            "train_name": "やくも5号",
        })
        result = handler.journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-15",
                "originStation": "A",
                "destinationStation": "D",
                "departureTimeMinutes": 590,
                "limit": 3,
                "maxTransfers": 3,
                "includeTrace": True,
                "requiredTrainNames": ["やくも"],
            },
        )

        self.assertEqual(
            [leg["serviceUid"] for leg in result["journeys"][0]["legs"]],
            ["feeder", "yakumo"],
        )
        self.assertEqual(result["requiredTrainNames"], ["やくも"])

    def test_connection_scan_limits_local_only_search_to_ordinary_trains(self) -> None:
        index = connection_index_from_legs([
            ("rapid", "3400M", "A", "D", 600, 620),
            ("local", "100M", "A", "D", 605, 650),
        ])
        index["trips"]["rapid"]["service_type"] = "新快速"
        result = handler.journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-15",
                "originStation": "A",
                "destinationStation": "D",
                "departureTimeMinutes": 590,
                "limit": 3,
                "maxTransfers": 3,
                "includeTrace": True,
                "allowedServiceTypes": ["普通"],
            },
        )

        self.assertEqual(
            result["journeys"][0]["legs"][0]["serviceUid"], "local"
        )
        self.assertEqual(result["allowedServiceTypes"], ["普通"])

    def test_connection_scan_applies_destination_changes_and_cancellations(self) -> None:
        request = {
            "serviceDate": "2026-08-14", "originStation": "向日町",
            "destinationStation": "大阪", "departureTimeMinutes": 580,
            "limit": 3, "maxTransfers": 3, "includeTrace": True,
            "transferPace": "standard", "rankingPreference": "balanced",
        }
        destination_changed = handler.journey_search.search_index(
            connection_index_fixture(), {}, request,
            operations={
                "538C": {
                    "delayMinutes": 0, "destination": "西大路", "sources": ["web"],
                },
                "1001M": {
                    "delayMinutes": 0, "destination": "大阪", "sources": ["web"],
                },
            },
            realtime_route_time=595,
        )
        cancelled = handler.journey_search.search_index(
            connection_index_fixture(), {}, request,
            operations={
                "1001M": {
                    "delayMinutes": 0, "destination": "大阪", "sources": ["web"],
                },
            },
            realtime_route_time=595,
        )

        self.assertEqual(destination_changed["journeys"], [])
        self.assertEqual(cancelled["journeys"], [])
        self.assertGreater(
            destination_changed["trace"]["realtimeActiveServicesRejected"], 0
        )
