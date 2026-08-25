from __future__ import annotations

import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import patch

from tests.services.agent_api.support import handler

from conversation_feedback import store_feedback


class RecordingS3:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.puts = []

    def put_object(self, **kwargs):
        if self.fail:
            raise RuntimeError("private storage failure")
        self.puts.append(kwargs)


class ConversationFeedbackTest(unittest.TestCase):
    def test_stores_the_bounded_v1_contract(self) -> None:
        client = RecordingS3()

        result = store_feedback(
            submission(),
            "private-bucket",
            client,
            datetime(2026, 8, 25, 9, 0, tzinfo=timezone.utc),
        )

        self.assertRegex(result["feedbackId"], r"^[0-9a-f-]+$")
        stored = client.puts[0]
        self.assertEqual(stored["Bucket"], "private-bucket")
        self.assertRegex(
            stored["Key"],
            r"^conversation-feedback/2026/08/25/[0-9a-f-]+\.json$",
        )
        self.assertEqual(stored["ContentType"], "application/json")
        self.assertEqual(stored["ServerSideEncryption"], "AES256")
        payload = json.loads(stored["Body"])
        self.assertEqual(payload["schemaVersion"], "conversation-feedback-v1")
        self.assertEqual(payload["createdAt"], "2026-08-25T09:00:00+00:00")
        self.assertEqual(payload["rating"], "bad")
        self.assertEqual(payload["requestIds"], ["request-1"])
        self.assertEqual(
            payload["conversation"],
            [
                {"role": "user", "text": "京都へ行きたい"},
                {"role": "assistant", "text": "経路を案内します"},
            ],
        )

    def test_rejects_invalid_rating_message_count_and_text(self) -> None:
        invalid_values = []
        invalid_values.append({**submission(), "rating": "neutral"})
        invalid_values.append({**submission(), "conversation": []})
        invalid_values.append({
            **submission(),
            "conversation": [message("user", "x")] * 51,
        })
        invalid_values.append({
            **submission(),
            "conversation": [message("system", "x")],
        })
        invalid_values.append({
            **submission(),
            "conversation": [message("user", " ")],
        })
        invalid_values.append({
            **submission(),
            "conversation": [message("user", "x" * 4001)],
        })

        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(handler.RequestError) as raised:
                    store_feedback(value, "private-bucket", RecordingS3())
                self.assertEqual(raised.exception.status_code, 400)

    def test_accepts_request_id_boundaries_and_rejects_invalid_ids(self) -> None:
        store_feedback(
            {**submission(), "requestIds": ["x" * 128] * 50},
            "private-bucket",
            RecordingS3(),
        )

        for request_ids in ([""], ["x" * 129], ["x"] * 51, "request-1"):
            with self.subTest(request_ids=request_ids):
                with self.assertRaises(handler.RequestError) as raised:
                    store_feedback(
                        {**submission(), "requestIds": request_ids},
                        "private-bucket",
                        RecordingS3(),
                    )
                self.assertEqual(raised.exception.status_code, 400)

    def test_handler_returns_a_bounded_error_when_s3_storage_fails(self) -> None:
        failing_s3 = RecordingS3(fail=True)
        fake_boto3 = types.SimpleNamespace(client=lambda _name: failing_s3)
        event = {
            "requestContext": {"http": {"method": "POST"}},
            "body": json.dumps({
                "operation": "conversation_feedback",
                **submission(),
            }),
        }
        output = StringIO()

        with (
            patch.dict(sys.modules, {"boto3": fake_boto3}),
            patch.object(handler, "CONVERSATION_FEEDBACK_BUCKET", "private-bucket"),
            redirect_stdout(output),
        ):
            response = handler.lambda_handler(
                event,
                types.SimpleNamespace(aws_request_id="storage-request-1"),
            )

        self.assertEqual(response["statusCode"], 503)
        self.assertEqual(
            json.loads(response["body"])["message"],
            "会話フィードバックを保存できませんでした。",
        )
        logs = output.getvalue()
        self.assertIn('"event": "conversation_feedback_store_failed"', logs)
        self.assertIn('"requestId": "storage-request-1"', logs)
        self.assertNotIn("private storage failure", logs)
        self.assertNotIn("京都へ行きたい", logs)

    def test_stores_v2_comment_and_message_identifiers(self) -> None:
        client = RecordingS3()

        store_feedback(submission_v2(), "private-bucket", client)

        payload = json.loads(client.puts[0]["Body"])
        self.assertEqual(payload["schemaVersion"], "conversation-feedback-v2")
        self.assertEqual(payload["comment"], "条件が反映されていません")
        self.assertEqual(payload["sessionId"], "session-1")
        self.assertEqual(payload["targetMessageId"], "message-2")
        self.assertEqual(payload["conversation"][-1]["requestId"], "request-1")

    def test_rejects_v2_target_comment_and_request_mismatches(self) -> None:
        invalid = [
            {**submission_v2(), "targetMessageId": "message-1"},
            {**submission_v2(), "comment": "\x00secret"},
            {**submission_v2(), "comment": " "},
            {**submission_v2(), "comment": "x" * 1001},
            {**submission_v2(), "rating": "good", "comment": "不要"},
            {**submission_v2(), "requestIds": []},
            {
                **submission_v2(),
                "conversation": [
                    submission_v2()["conversation"][0],
                    {
                        **submission_v2()["conversation"][1],
                        "messageId": "message-1",
                    },
                ],
                "targetMessageId": "message-1",
            },
        ]

        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(handler.RequestError) as raised:
                    store_feedback(value, "private-bucket", RecordingS3())
                self.assertEqual(raised.exception.status_code, 400)

    def test_rejects_v2_payload_instead_of_silently_truncating(self) -> None:
        value = submission_v2()
        value["conversation"] = [
            {
                "messageId": f"message-{index}",
                "role": "assistant" if index == 49 else "user",
                "text": "界" * 4000,
            }
            for index in range(50)
        ]
        value["targetMessageId"] = "message-49"
        value["requestIds"] = []

        with self.assertRaises(handler.RequestError) as raised:
            store_feedback(value, "private-bucket", RecordingS3())

        self.assertEqual(raised.exception.status_code, 413)


def submission():
    return {
        "rating": "bad",
        "requestIds": ["request-1"],
        "conversation": [
            message("user", " 京都へ行きたい "),
            message("assistant", " 経路を案内します "),
        ],
    }


def submission_v2():
    return {
        "schemaVersion": "conversation-feedback-v2",
        "rating": "bad",
        "comment": " 条件が反映されていません ",
        "sessionId": "session-1",
        "targetMessageId": "message-2",
        "requestIds": ["request-1"],
        "conversation": [
            {
                "messageId": "message-1",
                "role": "user",
                "text": "京都へ行きたい",
            },
            {
                "messageId": "message-2",
                "role": "assistant",
                "text": "経路を案内します",
                "requestId": "request-1",
            },
        ],
    }


def message(role: str, text: str):
    return {"role": role, "text": text}


if __name__ == "__main__":
    unittest.main()
