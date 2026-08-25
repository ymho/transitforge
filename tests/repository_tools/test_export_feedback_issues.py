from __future__ import annotations

import unittest

from tools.export_feedback_issues import ExportOptions, export_clusters


class FakeGateway:
    def __init__(self, issues=None) -> None:
        self.issues = issues or []
        self.created = []
        self.links = []

    def search(self, query):
        if "in:body" in query:
            marker = query.split('"')[1]
            return [issue for issue in self.issues if marker in issue.get("body", "")]
        title = query.split('"')[1]
        return [issue for issue in self.issues if issue.get("title") == title]

    def create(self, title, body, assignee, labels, milestone):
        issue = {
            "id": 9000 + len(self.created),
            "number": 200 + len(self.created),
            "title": title,
            "body": body,
            "assignee": assignee,
            "labels": labels,
            "milestone": milestone,
        }
        self.created.append(issue)
        self.issues.append(issue)
        return issue

    def link_parent(self, parent_number, issue_id):
        self.links.append((parent_number, issue_id))


class ExportFeedbackIssuesTest(unittest.TestCase):
    def test_dry_run_contains_only_public_summary(self) -> None:
        results = export_clusters(report(), FakeGateway(), ExportOptions())

        self.assertEqual(results[0]["status"], "ready")
        preview = str(results)
        self.assertIn("匿名化Feedback: 3件", preview)
        self.assertNotIn("feedback-1", preview)
        self.assertNotIn("request-1", preview)
        self.assertNotIn("会話の原文", preview)

    def test_requires_review_then_creates_and_links_a_single_issue(self) -> None:
        gateway = FakeGateway()
        unapproved = export_clusters(
            report(), gateway, ExportOptions(create=True)
        )
        self.assertEqual(unapproved[0]["status"], "not-approved")
        self.assertEqual(gateway.created, [])

        approved = ExportOptions(
            create=True,
            approved_fingerprints=frozenset({"0123456789abcdef"}),
        )
        created = export_clusters(report(), gateway, approved)
        repeated = export_clusters(report(), gateway, approved)

        self.assertEqual(created[0]["status"], "created")
        self.assertEqual(repeated[0]["status"], "duplicate")
        self.assertEqual(len(gateway.created), 1)
        self.assertEqual(gateway.created[0]["assignee"], "ymho")
        self.assertEqual(gateway.created[0]["milestone"], 4)
        self.assertEqual(gateway.links, [(184, 9000)])

    def test_stops_when_an_open_issue_has_the_same_title(self) -> None:
        gateway = FakeGateway([{
            "number": 42,
            "title": "経路検索で条件と異なる結果になる",
            "body": "既存Issue",
        }])

        result = export_clusters(report(), gateway, ExportOptions())

        self.assertEqual(result[0], {
            "status": "existing-candidate",
            "fingerprint": "0123456789abcdef",
            "issueNumber": 42,
        })


def report():
    return {
        "schemaVersion": "conversation-feedback-analysis-v1",
        "clusters": [{
            "fingerprint": "0123456789abcdef",
            "title": "経路検索で条件と異なる結果になる",
            "feature": "journey",
            "intent": "route-search",
            "symptom": "incorrect",
            "expected": "入力条件と決定論的な結果が一致する",
            "severity": "medium",
            "count": 3,
            "firstSeenAt": "2026-08-20T00:00:00Z",
            "lastSeenAt": "2026-08-25T00:00:00Z",
            "evidence": {
                "feedbackIds": ["feedback-1"],
                "requestIds": ["request-1"],
            },
            "privateConversation": "会話の原文",
        }],
    }


if __name__ == "__main__":
    unittest.main()
