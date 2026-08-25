from __future__ import annotations

import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import patch

from tests.agent_api_test_support import handler

from agent_trace_storage import store_agent_trace


class RecordingS3:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.puts = []

    def put_object(self, **kwargs):
        if self.fail:
            raise RuntimeError("private storage failure")
        self.puts.append(kwargs)


class AgentTraceStorageTest(unittest.TestCase):
    def test_stores_a_valid_trace_with_task_and_request_ids(self) -> None:
        client = RecordingS3()
        result = store_agent_trace(
            submission(),
            "private-bucket",
            client,
            datetime(2026, 8, 25, 9, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(result["eventCount"], 1)
        self.assertEqual(len(client.puts), 1)
        stored = client.puts[0]
        self.assertEqual(stored["Bucket"], "private-bucket")
        self.assertRegex(
            stored["Key"],
            r"^agent-traces/2026/08/25/task-1/[0-9a-f-]+\.json$",
        )
        self.assertEqual(stored["ServerSideEncryption"], "AES256")
        payload = json.loads(stored["Body"])
        self.assertEqual(payload["schemaVersion"], "agent-trace-submission-v1")
        self.assertEqual(payload["taskId"], "task-1")
        self.assertEqual(payload["executionId"], "execution-1")
        self.assertEqual(payload["requestIds"], ["model-request-1"])

    def test_rejects_unknown_events_and_out_of_order_sequences(self) -> None:
        for events in (
            [{
                "type": "run_javascript",
                "sequence": 1,
                "occurredAt": "2026-08-25T09:00:00Z",
            }],
            [
                trace_event(2, "first"),
                trace_event(1, "second"),
            ],
        ):
            with self.subTest(events=events):
                value = submission()
                value["trace"]["events"] = events
                with self.assertRaises(handler.RequestError) as raised:
                    store_agent_trace(value, "private-bucket", RecordingS3())
                self.assertEqual(raised.exception.status_code, 400)

    def test_rejects_a_trace_over_the_storage_size_limit(self) -> None:
        value = submission()
        value["trace"]["events"] = [
            trace_event(index + 1, "x" * 500)
            for index in range(70)
        ]

        with self.assertRaises(handler.RequestError) as raised:
            store_agent_trace(value, "private-bucket", RecordingS3())

        self.assertEqual(raised.exception.status_code, 413)

    def test_redacts_secrets_and_current_location_again_on_the_server(self) -> None:
        value = submission()
        value["trace"]["events"] = [{
            "type": "intent_normalized",
            "sequence": 1,
            "occurredAt": "2026-08-25T09:00:00Z",
            "intent": (
                "token=do-not-store Bearer private-token "
                "現在地35.0123,135.1234 緯度=35.1 経度=135.1"
            ),
            "constraints": {
                "byteLength": 100,
                "truncated": False,
                "value": {
                    "apiKey": "private-key",
                    "currentLocation": {
                        "latitude": 35.0,
                        "longitude": 135.0,
                    },
                    "station": "京都",
                },
            },
        }]
        client = RecordingS3()

        store_agent_trace(value, "private-bucket", client)

        stored = client.puts[0]["Body"].decode("utf-8")
        for private_value in (
            "do-not-store",
            "private-token",
            "private-key",
            "35.0",
            "135.0",
            "35.0123",
            "135.1234",
            "緯度=35.1",
            "経度=135.1",
        ):
            self.assertNotIn(private_value, stored)
        self.assertIn("[redacted]", stored)
        self.assertIn("[location-redacted]", stored)
        self.assertIn("京都", stored)

    def test_handler_returns_a_bounded_error_when_s3_storage_fails(self) -> None:
        failing_s3 = RecordingS3(fail=True)
        fake_boto3 = types.SimpleNamespace(client=lambda _name: failing_s3)
        event = {
            "requestContext": {"http": {"method": "POST"}},
            "body": json.dumps({"operation": "agent_trace", **submission()}),
        }
        output = StringIO()

        with (
            patch.dict(sys.modules, {"boto3": fake_boto3}),
            patch.object(handler, "AGENT_TRACE_BUCKET", "private-bucket"),
            redirect_stdout(output),
        ):
            response = handler.lambda_handler(
                event,
                types.SimpleNamespace(aws_request_id="storage-request-1"),
            )

        self.assertEqual(response["statusCode"], 503)
        self.assertEqual(
            json.loads(response["body"])["message"],
            "Agent Traceを保存できませんでした。",
        )
        logs = output.getvalue()
        self.assertIn('"event": "agent_trace_store_failed"', logs)
        self.assertNotIn("private storage failure", logs)

    def test_handler_logs_only_trace_identifiers_after_success(self) -> None:
        client = RecordingS3()
        fake_boto3 = types.SimpleNamespace(client=lambda _name: client)
        event = {
            "requestContext": {"http": {"method": "POST"}},
            "body": json.dumps({"operation": "agent_trace", **submission()}),
        }
        output = StringIO()

        with (
            patch.dict(sys.modules, {"boto3": fake_boto3}),
            patch.object(handler, "AGENT_TRACE_BUCKET", "private-bucket"),
            redirect_stdout(output),
        ):
            response = handler.lambda_handler(
                event,
                types.SimpleNamespace(aws_request_id="storage-request-1"),
            )

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(
            response["headers"]["x-transitforge-request-id"],
            "storage-request-1",
        )
        logs = output.getvalue()
        self.assertIn('"event": "agent_trace_stored"', logs)
        self.assertIn('"taskId": "task-1"', logs)
        self.assertIn('"relatedRequestCount": 1', logs)
        self.assertNotIn("京都から出雲市へ行きたい", logs)


def submission():
    return {
        "taskId": "task-1",
        "requestIds": ["model-request-1"],
        "trace": {
            "executionId": "execution-1",
            "droppedEventCount": 0,
            "events": [trace_event(1, "京都から出雲市へ行きたい")],
        },
    }


def trace_event(sequence: int, response: str):
    return {
        "type": "response_generated",
        "sequence": sequence,
        "occurredAt": "2026-08-25T09:00:00Z",
        "response": response,
        "claimIds": [],
    }
