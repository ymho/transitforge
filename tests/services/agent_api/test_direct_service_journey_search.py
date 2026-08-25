from tests.services.agent_api.support import *

class DirectServiceJourneySearchTest(unittest.TestCase):

    def test_direct_index_compares_direct_and_one_transfer_journeys(self) -> None:
        result = handler.journey_search.direct_service_journey_search.search_index(
            direct_service_index_fixture(),
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 1)
        self.assertEqual(
            [leg["trainNumber"] for leg in result["journeys"][0]["legs"]],
            ["100M", "200M"],
        )
        self.assertEqual(result["journeys"][0]["arrivalTimeMinutes"], 625)
        self.assertEqual(
            [leg["serviceDestination"] for leg in result["journeys"][0]["legs"]],
            ["乗換", "到着"],
        )
        self.assertEqual(
            result["journeys"][0]["legs"][0]["stops"],
            [
                {"stationName": "出発", "departureTimeMinutes": 600.0},
                {"stationName": "乗換", "arrivalTimeMinutes": 610.0},
            ],
        )
        self.assertEqual(result["journeys"][1]["transferCount"], 0)
        self.assertEqual(result["trace"]["strategy"], "direct-service-index")
        self.assertEqual(
            result["trace"]["selectedJourneys"][0]["transferStations"],
            ["乗換"],
        )
        self.assertEqual(
            result["trace"]["selectedJourneys"][0]["transferWaitMinutes"],
            [5.0],
        )

    def test_direct_index_excludes_shinkansen_services(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["direct"]["service_type"] = "新幹線"
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-15",
                "originStation": "出発",
                "destinationStation": "到着",
                "departureTimeMinutes": 590,
                "limit": 3,
                "maxTransfers": 1,
                "includeTrace": True,
                "excludedServiceTypes": ["新幹線"],
            },
        )

        self.assertEqual(result["trace"]["excludedServices"], 1)
        self.assertTrue(result["journeys"])
        self.assertTrue(all(
            leg["serviceType"] != "新幹線"
            for journey in result["journeys"]
            for leg in journey["legs"]
        ))

    def test_direct_index_requires_a_named_train_in_the_whole_journey(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["second"].update({
            "service_type": "特急",
            "train_name": "やくも5号",
        })
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-15",
                "originStation": "出発",
                "destinationStation": "到着",
                "departureTimeMinutes": 590,
                "limit": 3,
                "maxTransfers": 1,
                "includeTrace": True,
                "requiredTrainNames": ["やくも"],
            },
        )

        self.assertEqual(len(result["journeys"]), 1)
        self.assertEqual(
            [leg["serviceUid"] for leg in result["journeys"][0]["legs"]],
            ["first", "second"],
        )

    def test_direct_index_excludes_named_and_specific_trains(self) -> None:
        exclusion_cases = (
            ("excludedTrainNames", "ひかり", "ひかり500号"),
            ("excludedTrainNames", "ひかり500号", "ひかり500号"),
            ("excludedTrainNumbers", "300M", "ひかり500号"),
            ("excludedServiceUids", "direct", "ひかり500号"),
        )
        for field, value, train_name in exclusion_cases:
            with self.subTest(field=field, value=value):
                index = direct_service_index_fixture()
                index["services"]["direct"]["train_name"] = train_name
                result = (
                    handler.journey_search.direct_service_journey_search.search_index(
                        index,
                        {},
                        {
                            "serviceDate": "2026-08-15",
                            "originStation": "出発",
                            "destinationStation": "到着",
                            "departureTimeMinutes": 590,
                            "limit": 3,
                            "maxTransfers": 1,
                            "includeTrace": True,
                            field: [value],
                        },
                    )
                )

                self.assertTrue(result["journeys"])
                self.assertTrue(all(
                    leg["serviceUid"] != "direct"
                    for journey in result["journeys"]
                    for leg in journey["legs"]
                ))
                self.assertEqual(result["trace"][field], [value])

    def test_train_name_with_a_different_number_is_not_excluded(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["direct"]["train_name"] = "ひかり500号"
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-15",
                "originStation": "出発",
                "destinationStation": "到着",
                "departureTimeMinutes": 590,
                "limit": 3,
                "maxTransfers": 1,
                "includeTrace": True,
                "excludedTrainNames": ["ひかり501号"],
            },
        )

        self.assertTrue(any(
            leg["serviceUid"] == "direct"
            for journey in result["journeys"]
            for leg in journey["legs"]
        ))

    def test_direct_index_rejects_tight_transfer_and_applies_delay(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["second"]["calls"][0]["departure_time_minutes"] = 614
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {"100M": Decimal(5), "300M": Decimal(5)},
            {
                "serviceDate": "2026-08-14", "originStation": "出発駅",
                "destinationStation": "到着駅", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertTrue(all(
            journey["transferCount"] == 0 for journey in result["journeys"]
        ))
        self.assertEqual(result["journeys"][0]["departureTimeMinutes"], 605)
        self.assertEqual(result["journeys"][0]["arrivalTimeMinutes"], 645)
        self.assertGreater(
            result["trace"]["secondBoardingsRejectedByTransferTime"], 0
        )

    def test_direct_index_estimates_a_future_direct_train_delay(self) -> None:
        index = {
            "schema_version": "direct-service-index-v1",
            "service_date": "2026-08-14",
            "services": {
                "observed": direct_service(
                    "observed", "100M",
                    [("姫路", None, 580), ("東姫路", 584, None)],
                ),
                "candidate": direct_service(
                    "candidate", "102M",
                    [("姫路", None, 610), ("東姫路", 614, None)],
                ),
            },
            "station_origins": {"姫路": ["observed", "candidate"]},
        }
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "姫路",
                "destinationStation": "東姫路", "departureTimeMinutes": 600,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
            operations={
                "100M": {
                    "delayMinutes": 8, "destination": "東姫路",
                    "sources": ["source-a"],
                },
            },
        )

        leg = result["journeys"][0]["legs"][0]
        self.assertEqual(leg["departureTimeMinutes"], 618)
        self.assertEqual(leg["arrivalTimeMinutes"], 622)
        self.assertEqual(leg["delayStatus"], "estimated")
        self.assertEqual(result["trace"]["estimatedDelayTrips"], 1)

    def test_direct_index_can_limit_the_search_to_direct_journeys(self) -> None:
        result = handler.journey_search.direct_service_journey_search.search_index(
            direct_service_index_fixture(),
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 0, "includeTrace": True,
            },
        )

        self.assertEqual(len(result["journeys"]), 1)
        self.assertEqual(result["journeys"][0]["transferCount"], 0)
        self.assertEqual(result["journeys"][0]["legs"][0]["trainNumber"], "300M")
        self.assertEqual(result["trace"]["transferCandidates"], 0)

    def test_direct_index_prefers_a_close_direct_arrival(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["second"]["calls"][1]["arrival_time_minutes"] = 635
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 0)
        self.assertEqual(result["journeys"][0]["arrivalTimeMinutes"], 640)
        self.assertEqual(result["journeys"][1]["arrivalTimeMinutes"], 635)

    def test_direct_index_uses_the_realtime_destination_as_authoritative(self) -> None:
        index = direct_service_index_fixture()
        index["services"]["direct"]["calls"].insert(
            1,
            {
                "station_name": "途中",
                "arrival_time_minutes": 620,
                "departure_time_minutes": 621,
            },
        )
        result = handler.journey_search.direct_service_journey_search.search_index(
            index,
            {},
            {
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590.0,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
            operations={
                "300M": {
                    "delayMinutes": 0,
                    "destination": "途中",
                    "sources": ["source-a"],
                },
            },
            realtime_route_time=590,
        )

        self.assertNotIn(
            "300M",
            [
                leg["trainNumber"]
                for journey in result["journeys"]
                for leg in journey["legs"]
            ],
        )

    def test_journey_search_loads_the_direct_index_for_one_transfer(self) -> None:
        handler.journey_search._index_cache.clear()
        client = FakeS3(direct_service_index_fixture())

        result = handler.journey_search.search(
            client,
            bucket="private-bucket",
            prefix="timetable",
            value={
                "serviceDate": "2026-08-14", "originStation": "出発",
                "destinationStation": "到着", "departureTimeMinutes": 590,
                "limit": 3, "maxTransfers": 1, "includeTrace": True,
            },
        )

        self.assertEqual(result["journeys"][0]["transferCount"], 1)
        self.assertEqual(
            client.requests[0]["Key"],
            "timetable/normalized/2026-08-14/direct-service-index.json.gz",
        )

    def test_journey_search_uses_a_fresh_current_snapshot_only(self) -> None:
        handler.journey_search._index_cache.clear()
        snapshot = {
            "collectedAt": "2026-08-14T01:00:00+00:00",
            "failedSources": [],
            "trains": {
                "100M": {
                    "delayMinutes": 5,
                    "destination": "乗換",
                    "sources": ["source-a"],
                },
                "200M": {
                    "delayMinutes": 5,
                    "destination": "到着",
                    "sources": ["source-a"],
                },
            },
        }
        client = FakeS3(direct_service_index_fixture(), snapshot)
        request = {
            "serviceDate": "2026-08-14", "originStation": "出発",
            "destinationStation": "到着", "departureTimeMinutes": 600,
            "limit": 3, "maxTransfers": 1, "includeTrace": True,
        }

        current = handler.journey_search.search(
            client,
            bucket="private-bucket",
            prefix="timetable",
            snapshot_bucket="web-bucket",
            value=request,
            now=datetime(2026, 8, 14, 1, 0, tzinfo=timezone.utc),
        )

        self.assertTrue(current["realtime"]["applied"])
        self.assertEqual(current["journeys"][0]["legs"][0]["delayMinutes"], 5)
        self.assertIn(
            "api/traffic/delays.json",
            [item["Key"] for item in client.requests],
        )

        client.requests.clear()
        future = handler.journey_search.search(
            client,
            bucket="private-bucket",
            prefix="timetable",
            snapshot_bucket="web-bucket",
            value={**request, "serviceDate": "2026-08-15"},
            now=datetime(2026, 8, 14, 1, 0, tzinfo=timezone.utc),
        )

        self.assertFalse(future["realtime"]["applied"])
        self.assertEqual(future["realtime"]["reason"], "future-or-past-service-date")
        self.assertNotIn(
            "api/traffic/delays.json",
            [item["Key"] for item in client.requests],
        )
