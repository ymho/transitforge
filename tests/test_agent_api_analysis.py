from tests.agent_api_test_support import *

class BedrockAgentAnalysisTest(unittest.TestCase):

    def test_finds_the_peak_observation_and_top_trains_for_a_day(self) -> None:
        client = FakeDynamoDB(
            [
                dynamo_item(
                    "2026-07-29T00:00:00+00:00",
                    total=100,
                    train_totals={"100A": 60, "200B": 40},
                ),
                dynamo_item(
                    "2026-07-29T08:15:00+00:00",
                    total=240,
                    train_totals={"100A": 80, "300C": 160},
                ),
            ]
        )

        result = handler.query_daily_congestion_peak(
            client,
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 2)
        self.assertEqual(result["peak"]["totalCongestion"], 240)
        self.assertEqual(
            result["peak"]["topTrains"],
            [
                {"trainNumber": "300C", "totalCongestion": 160},
                {"trainNumber": "100A", "totalCongestion": 80},
            ],
        )
        self.assertEqual(client.queries[0]["TableName"], "summaries")

    def test_builds_hourly_and_per_train_congestion_analysis(self) -> None:
        client = FakeDynamoDB(
            [
                dynamo_item(
                    "2026-07-29T07:00:00+00:00",
                    total=100,
                    train_totals={"100A": 60, "200B": 40},
                ),
                dynamo_item(
                    "2026-07-29T07:30:00+00:00",
                    total=200,
                    train_totals={"100A": 100, "200B": 100},
                ),
                dynamo_item(
                    "2026-07-29T08:15:00+00:00",
                    total=240,
                    train_totals={"100A": 80, "300C": 160},
                ),
            ]
        )

        result = handler.query_daily_congestion_analysis(
            client,
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 3)
        self.assertEqual(result["observationStart"], "2026-07-29T07:00:00+00:00")
        self.assertEqual(result["observationEnd"], "2026-07-29T08:15:00+00:00")
        self.assertEqual(
            result["hourly"][16],
            {
                "hourJst": 16,
                "sampleCount": 2,
                "averageTotalCongestion": 150,
                "peakTotalCongestion": 200,
                "peakCollectedAt": "2026-07-29T07:30:00+00:00",
                "averageTrainCount": 2,
                "topTrain": {
                    "trainNumber": "100A",
                    "observedSampleCount": 2,
                    "averageCongestion": 80,
                    "dailyAverageContribution": 80,
                    "peakCongestion": 100,
                    "peakCollectedAt": "2026-07-29T07:30:00+00:00",
                },
            },
        )
        self.assertEqual(result["hourly"][17]["averageTotalCongestion"], 240)
        self.assertEqual(
            result["trainStats"][0],
            {
                "trainNumber": "300C",
                "observedSampleCount": 1,
                "averageCongestion": 160,
                "dailyAverageContribution": 53.33,
                "peakCongestion": 160,
                "peakCollectedAt": "2026-07-29T08:15:00+00:00",
            },
        )

    def test_returns_empty_24_hour_analysis_when_a_day_has_no_samples(self) -> None:
        result = handler.query_daily_congestion_analysis(
            FakeDynamoDB([]),
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 0)
        self.assertIsNone(result["peak"])
        self.assertEqual(len(result["hourly"]), 24)
        self.assertTrue(all(hour["sampleCount"] == 0 for hour in result["hourly"]))
        self.assertEqual(result["trainStats"], [])

    def test_handles_an_observation_without_valid_train_congestion(self) -> None:
        result = handler.query_daily_congestion_analysis(
            FakeDynamoDB(
                [
                    dynamo_item(
                        "2026-07-29T08:15:00+00:00",
                        total=0,
                        train_totals={},
                    )
                ]
            ),
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 1)
        self.assertIsNone(result["hourly"][17]["topTrain"])
        self.assertEqual(result["trainStats"], [])

    def test_returns_no_peak_when_a_day_has_no_samples(self) -> None:
        result = handler.query_daily_congestion_peak(
            FakeDynamoDB([]),
            "summaries",
            "2026-07-29",
        )

        self.assertEqual(
            result,
            {"serviceDate": "2026-07-29", "sampleCount": 0, "peak": None},
        )

    def test_builds_latest_hourly_and_per_train_delay_analysis(self) -> None:
        client = FakeDynamoDB(
            [
                delay_dynamo_item(
                    "2026-07-29T07:00:00+00:00",
                    {"100A": 3, "200B": 8},
                ),
                delay_dynamo_item(
                    "2026-07-29T07:30:00+00:00",
                    {"100A": 5},
                ),
                delay_dynamo_item(
                    "2026-07-29T08:15:00+00:00",
                    {"300C": 12},
                    failures=1,
                ),
            ]
        )

        result = handler.query_train_delay_analysis(
            client,
            "delay-summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 3)
        self.assertEqual(result["latest"]["failureCount"], 1)
        self.assertEqual(result["latest"]["topTrains"][0], {
            "trainNumber": "300C",
            "delayMinutes": 12,
        })
        self.assertEqual(result["peak"]["delayedTrainCount"], 2)
        self.assertEqual(result["hourly"][16]["averageDelayedTrainCount"], 1.5)
        self.assertEqual(result["hourly"][16]["maximumDelayMinutes"], 8)
        self.assertEqual(result["hourly"][17]["peakTotalDelayMinutes"], 12)
        self.assertEqual(result["trainStats"][0]["trainNumber"], "300C")
        self.assertEqual(result["trainStats"][1]["delayedSampleCount"], 1)
        self.assertEqual(client.queries[0]["TableName"], "delay-summaries")

    def test_returns_unobserved_delay_hours_as_null(self) -> None:
        result = handler.query_train_delay_analysis(
            FakeDynamoDB([]),
            "delay-summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 0)
        self.assertIsNone(result["latest"])
        self.assertIsNone(result["peak"])
        self.assertEqual(len(result["hourly"]), 24)
        self.assertIsNone(result["hourly"][0]["averageDelayedTrainCount"])

    def test_queries_delays_from_4am_through_359am_as_one_operating_day(self) -> None:
        client = FakeDynamoDB(
            [
                delay_dynamo_item(
                    "2026-07-28T18:59:59+00:00",
                    {"before": 1},
                    service_date="2026-07-29",
                ),
                delay_dynamo_item(
                    "2026-07-28T19:00:00+00:00",
                    {"start": 2},
                    service_date="2026-07-29",
                ),
                delay_dynamo_item(
                    "2026-07-29T18:59:59+00:00",
                    {"end": 3},
                    service_date="2026-07-30",
                ),
                delay_dynamo_item(
                    "2026-07-29T19:00:00+00:00",
                    {"after": 4},
                    service_date="2026-07-30",
                ),
            ]
        )

        result = handler.query_train_delay_analysis(
            client,
            "delay-summaries",
            "2026-07-29",
        )

        self.assertEqual(result["sampleCount"], 2)
        self.assertEqual(result["observationStart"], "2026-07-28T19:00:00+00:00")
        self.assertEqual(result["observationEnd"], "2026-07-29T18:59:59+00:00")
        self.assertEqual(
            [
                query["ExpressionAttributeValues"][":service_date"]["S"]
                for query in client.queries
            ],
            ["2026-07-29", "2026-07-30"],
        )
