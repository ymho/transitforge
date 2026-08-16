from tests.bedrock_agent_test_support import *

class BedrockAgentHttpTest(unittest.TestCase):

    def test_accepts_a_user_message_and_uses_the_configured_tools(self) -> None:
        client = FakeBedrock()
        messages = handler.request_messages(
            {
                "requestContext": {"http": {"method": "POST"}},
                "body": json.dumps(
                    {
                        "messages": [
                            {
                                "role": "user",
                                "content": [{"text": "18時30分にして"}],
                            }
                        ]
                    }
                ),
            }
        )

        result = handler.converse(client, messages)

        self.assertEqual(result["stopReason"], "end_turn")
        assert client.request
        self.assertEqual(client.request["modelId"], handler.MODEL_ID)
        self.assertEqual(
            [
                item["toolSpec"]["name"]
                for item in client.request["toolConfig"]["tools"]
            ],
            [
                "search_accommodations",
                "set_display_time",
                "search_trains",
                "query_daily_congestion_analysis",
                "search_direct_routes",
                "search_train_arrivals",
                "search_representative_timetable",
                "query_train_delay_analysis",
                "focus_train",
                "set_weather",
                "set_layer_visibility",
            ],
        )

    def test_searches_a_private_representative_timetable(self) -> None:
        handler.representative_timetable._cache.clear()
        client = FakeS3({
            "schema_version": "ai-timetable-v1",
            "service_date": "2026-07-31",
            "timetable_kind": "weekday",
            "trains": [{
                "service_uid": "service-1",
                "train_no": "101M",
                "service_type": "特急",
                "train_name": "はるか16号",
                "origin_station": "関西空港",
                "destination_station": "京都",
                "stops": [
                    {"station_name": "大阪", "event": "着", "route_time_minutes": 600},
                    {"station_name": "大阪", "event": "発", "route_time_minutes": 602},
                ],
            }],
        })

        result = handler.representative_timetable.search(
            client,
            "private-bucket",
            "ai-timetable",
            {
                "timetableKind": "weekday",
                "query": "平日の10時ごろ大阪に着く特急",
                "mode": "arrivals",
                "targetTimeMinutes": 600,
            },
        )

        self.assertEqual(result["serviceDate"], "2026-07-31")
        self.assertEqual(result["totalMatchCount"], 1)
        self.assertEqual(result["matches"][0]["trainNumber"], "101M")
        self.assertEqual(
            client.requests[0]["Key"], "ai-timetable/weekday.json.gz"
        )

    def test_accepts_only_the_tool_conversation_blocks_we_relay(self) -> None:
        messages = handler.request_messages(
            {
                "requestContext": {"http": {"method": "POST"}},
                "body": json.dumps(
                    {
                        "messages": [
                            {
                                "role": "assistant",
                                "content": [
                                    {"text": "列車を検索します。"},
                                    {
                                        "toolUse": {
                                            "toolUseId": "tool-1",
                                            "name": "search_trains",
                                            "input": {"query": "京都行き"},
                                        }
                                    }
                                ],
                            },
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "toolResult": {
                                            "toolUseId": "tool-1",
                                            "status": "success",
                                            "content": [{"json": {"matches": []}}],
                                        }
                                    }
                                ],
                            },
                        ]
                    }
                ),
            }
        )

        self.assertEqual(len(messages), 2)
        self.assertEqual(
            messages[0]["content"][0],
            {"text": "列車を検索します。"},
        )

    def test_rejects_unknown_tools_and_oversized_prompts(self) -> None:
        for body in (
            {
                "messages": [
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "toolUse": {
                                    "toolUseId": "tool-1",
                                    "name": "delete_train",
                                    "input": {},
                                }
                            }
                        ],
                    }
                ]
            },
            {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": "a" * 4_001}],
                    }
                ]
            },
        ):
            with self.subTest(body=body):
                with self.assertRaises(handler.RequestError):
                    handler.request_messages(
                        {
                            "requestContext": {"http": {"method": "POST"}},
                            "body": json.dumps(body),
                        }
                    )

    def test_returns_a_no_store_error_for_non_post_requests(self) -> None:
        result = handler.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}},
            None,
        )

        self.assertEqual(result["statusCode"], 405)
        self.assertEqual(result["headers"]["cache-control"], "no-store")
        self.assertIn("x-transitforge-request-id", result["headers"])

    def test_rejects_unbounded_journey_exclusions(self) -> None:
        base = {
            "serviceDate": "2026-08-15",
            "originStation": "高槻",
            "destinationStation": "米原",
            "departureTimeMinutes": 600,
        }
        for exclusions in (
            {"excludedTrainNames": ["a"] * 9},
            {"excludedTrainNumbers": [""]},
            {"excludedServiceUids": ["a" * 161]},
        ):
            with self.subTest(exclusions=exclusions):
                with self.assertRaises(handler.RequestError):
                    handler.journey_search._validated_request({
                        **base, **exclusions,
                    })

    def test_rejects_too_many_required_journey_conditions(self) -> None:
        with self.assertRaises(handler.RequestError):
            handler.journey_search._validated_request({
                "serviceDate": "2026-08-15",
                "originStation": "京都",
                "destinationStation": "出雲市",
                "departureTimeMinutes": 600,
                "requiredServiceTypes": ["特急", "新幹線"],
                "requiredTrainNames": ["やくも", "はるか"],
                "requiredTrainNumbers": ["1005M"],
            })
