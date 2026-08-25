from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.analyze_conversation_feedback import (
    analyze_feedback,
    load_local_feedback,
    markdown_report,
)
from datetime import date


class AnalyzeConversationFeedbackTest(unittest.TestCase):
    def test_clusters_the_same_symptom_and_keeps_different_symptoms_apart(self) -> None:
        report = analyze_feedback([
            feedback("fb-1", "経路検索でボタンを押しても動かない"),
            feedback("fb-2", "列車の経路検索が失敗してできません"),
            feedback("fb-3", "経路検索の表示時刻がおかしい"),
            {**feedback("good-1", "問題なし"), "rating": "good"},
        ])

        self.assertEqual(report["feedbackCount"], 3)
        self.assertEqual(report["clusterCount"], 2)
        counts = sorted(cluster["count"] for cluster in report["clusters"])
        self.assertEqual(counts, [1, 2])
        clustered = next(item for item in report["clusters"] if item["count"] == 2)
        self.assertEqual(clustered["evidence"]["feedbackIds"], ["fb-1", "fb-2"])

    def test_report_never_contains_raw_conversation_or_private_values(self) -> None:
        report = analyze_feedback([
            feedback(
                "fb-private",
                "山田太郎 user@example.com token=secret-value 35.12345,135.12345 表示がおかしい",
            )
        ])
        serialized = json.dumps(report, ensure_ascii=False) + markdown_report(report)

        for private in ("山田太郎", "user@example.com", "secret-value", "35.12345"):
            self.assertNotIn(private, serialized)
        self.assertIn("fb-private", serialized)

    def test_loads_only_the_requested_period_and_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "one.json").write_text(
                json.dumps(feedback("fb-1", "失敗", "2026-08-24T01:00:00Z")),
                encoding="utf-8",
            )
            (root / "two.json").write_text(
                json.dumps(feedback("fb-2", "失敗", "2026-08-25T01:00:00Z")),
                encoding="utf-8",
            )

            values = load_local_feedback(
                root, date(2026, 8, 25), date(2026, 8, 25), 1
            )

        self.assertEqual([value["feedbackId"] for value in values], ["fb-2"])


def feedback(
    feedback_id: str,
    comment: str,
    created_at: str = "2026-08-25T00:00:00Z",
):
    return {
        "schemaVersion": "conversation-feedback-v2",
        "feedbackId": feedback_id,
        "createdAt": created_at,
        "rating": "bad",
        "comment": comment,
        "requestIds": [f"request-{feedback_id}"],
        "conversation": [
            {"messageId": "message-1", "role": "user", "text": comment},
            {"messageId": "message-2", "role": "assistant", "text": "回答"},
        ],
    }


if __name__ == "__main__":
    unittest.main()
