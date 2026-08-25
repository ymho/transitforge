#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

EXPECTED_REPORT_SCHEMA = "conversation-feedback-analysis-v1"
DEFAULT_REPOSITORY = "ymho/transitforge"
DEFAULT_ASSIGNEE = "ymho"
DEFAULT_LABELS = ("area: ai", "type: reliability")
DEFAULT_MILESTONE = 4
DEFAULT_PARENT = 184
ALLOWED_TITLES = {
    f"{feature}で{symptom}"
    for feature in ("宿泊検索", "経路検索", "旅程", "Viewer", "会話", "未分類機能")
    for symptom in (
        "操作が完了しない", "条件と異なる結果になる", "必要な情報が欠落する",
        "同じ内容が重複する", "応答に時間がかかる", "操作や表示が分かりにくい",
        "意図に沿わない結果になる",
    )
}
ALLOWED_EXPECTATIONS = {
    "対象操作がエラーなく完了する",
    "入力条件と決定論的な結果が一致する",
    "必要な情報または操作対象が欠落せず表示される",
    "同じ内容が重複せず一度だけ処理される",
    "利用者を待たせない時間内に処理が完了する",
    "次に行う操作と結果を迷わず理解できる",
    "利用者の意図に沿う結果を返す",
}


class IssueGateway(Protocol):
    def search(self, query: str) -> list[dict[str, Any]]: ...

    def create(
        self,
        title: str,
        body: str,
        assignee: str,
        labels: tuple[str, ...],
        milestone: int,
    ) -> dict[str, Any]: ...

    def link_parent(self, parent_number: int, issue_id: int) -> None: ...


@dataclass(frozen=True)
class ExportOptions:
    create: bool = False
    approved_fingerprints: frozenset[str] = frozenset()
    assignee: str = DEFAULT_ASSIGNEE
    labels: tuple[str, ...] = DEFAULT_LABELS
    milestone: int = DEFAULT_MILESTONE
    parent_number: int = DEFAULT_PARENT


class GhIssueGateway:
    def __init__(self, repository: str) -> None:
        self.repository = repository

    def search(self, query: str) -> list[dict[str, Any]]:
        result = self._run([
            "api", "search/issues", "--method", "GET",
            "-f", f"q=repo:{self.repository} {query}",
            "-f", "per_page=100",
        ])
        items = result.get("items", [])
        return items if isinstance(items, list) else []

    def create(
        self,
        title: str,
        body: str,
        assignee: str,
        labels: tuple[str, ...],
        milestone: int,
    ) -> dict[str, Any]:
        return self._run(
            ["api", f"repos/{self.repository}/issues", "--method", "POST", "--input", "-"],
            {
                "title": title,
                "body": body,
                "assignees": [assignee],
                "labels": list(labels),
                "milestone": milestone,
            },
        )

    def link_parent(self, parent_number: int, issue_id: int) -> None:
        self._run(
            [
                "api",
                f"repos/{self.repository}/issues/{parent_number}/sub_issues",
                "--method", "POST", "--input", "-",
            ],
            {"sub_issue_id": issue_id},
        )

    @staticmethod
    def _run(arguments: list[str], payload: dict[str, Any] | None = None) -> dict[str, Any]:
        completed = subprocess.run(
            ["gh", *arguments],
            input=json.dumps(payload) if payload is not None else None,
            text=True,
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "GitHub APIの呼び出しに失敗しました")
        value = json.loads(completed.stdout or "{}")
        return value if isinstance(value, dict) else {}


def export_clusters(
    report: dict[str, Any],
    gateway: IssueGateway,
    options: ExportOptions,
) -> list[dict[str, Any]]:
    clusters = validated_clusters(report)
    results = []
    for cluster in clusters:
        fingerprint = cluster["fingerprint"]
        title = cluster["title"]
        body = issue_body(cluster, options.parent_number)
        marker = cluster_marker(fingerprint)

        duplicate = next(
            (
                issue for issue in gateway.search(f'"{marker}" in:body')
                if marker in str(issue.get("body", ""))
            ),
            None,
        )
        if duplicate:
            results.append(result("duplicate", cluster, duplicate.get("number")))
            continue

        existing = next(
            (
                issue for issue in gateway.search(f'"{title}" in:title is:open')
                if normalized_title(issue.get("title")) == normalized_title(title)
            ),
            None,
        )
        if existing:
            results.append(result("existing-candidate", cluster, existing.get("number")))
            continue

        public_preview = {"title": title, "body": body}
        if not options.create:
            results.append({**result("ready", cluster), **public_preview})
            continue
        if fingerprint not in options.approved_fingerprints:
            results.append(result("not-approved", cluster))
            continue

        created = gateway.create(
            title,
            body,
            options.assignee,
            options.labels,
            options.milestone,
        )
        issue_id = created.get("id")
        if not isinstance(issue_id, int):
            raise RuntimeError("作成IssueのIDを取得できませんでした")
        gateway.link_parent(options.parent_number, issue_id)
        results.append(result("created", cluster, created.get("number")))
    return results


def issue_body(cluster: dict[str, Any], parent_number: int) -> str:
    impact = {
        "high": "主要タスクを完了できない",
        "medium": "結果の信頼性または操作継続へ影響する",
        "low": "理解しやすさまたは操作効率へ影響する",
    }[cluster["severity"]]
    return "\n".join([
        "## 症状",
        "",
        cluster["title"],
        "",
        "## 期待結果",
        "",
        cluster["expected"],
        "",
        "## 影響",
        "",
        impact,
        "",
        "## Evidence",
        "",
        f"- 同種の匿名化Feedback: {cluster['count']}件",
        f"- 発生期間: {cluster['firstSeenAt']} 〜 {cluster['lastSeenAt']}",
        "- 生会話とrequest IDは非公開reportだけで確認する",
        "",
        f"親Issue: #{parent_number}",
        "",
        cluster_marker(cluster["fingerprint"]),
    ])


def validated_clusters(report: dict[str, Any]) -> list[dict[str, Any]]:
    if report.get("schemaVersion") != EXPECTED_REPORT_SCHEMA:
        raise ValueError("分析reportのschemaVersionが不正です")
    clusters = report.get("clusters")
    if not isinstance(clusters, list) or len(clusters) > 500:
        raise ValueError("分析reportのclusterが不正です")
    return [validated_cluster(cluster) for cluster in clusters]


def validated_cluster(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("clusterの形式が不正です")
    required_strings = (
        "fingerprint", "title", "symptom", "expected", "severity",
        "firstSeenAt", "lastSeenAt",
    )
    if any(not safe_public_text(value.get(field), 300) for field in required_strings):
        raise ValueError("clusterの公開項目が不正です")
    if value["severity"] not in {"high", "medium", "low"}:
        raise ValueError("clusterの重大度が不正です")
    if (
        not re.fullmatch(r"[0-9a-f]{16}", value["fingerprint"])
        or value["title"] not in ALLOWED_TITLES
        or value["expected"] not in ALLOWED_EXPECTATIONS
        or not valid_timestamp(value["firstSeenAt"])
        or not valid_timestamp(value["lastSeenAt"])
    ):
        raise ValueError("clusterに公開できない値が含まれています")
    if not isinstance(value.get("count"), int) or not 1 <= value["count"] <= 500:
        raise ValueError("clusterの件数が不正です")
    return {field: value[field] for field in (*required_strings, "count")}


def result(
    status: str,
    cluster: dict[str, Any],
    issue_number: Any = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "fingerprint": cluster["fingerprint"],
        **({"issueNumber": issue_number} if isinstance(issue_number, int) else {}),
    }


def cluster_marker(fingerprint: str) -> str:
    return f"<!-- feedback-cluster:{fingerprint} -->"


def normalized_title(value: Any) -> str:
    return " ".join(value.lower().split()) if isinstance(value, str) else ""


def safe_public_text(value: Any, limit: int) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= limit
        and "<!--" not in value
        and "@" not in value
        and not any(ord(character) < 32 and character not in "\n\t" for character in value)
    )


def valid_timestamp(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="レビュー済みFeedback clusterを重複なくGitHub Issueへ変換する"
    )
    parser.add_argument("report", type=Path)
    parser.add_argument("--repo", default=DEFAULT_REPOSITORY)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--approved-fingerprint", action="append", default=[])
    parser.add_argument("--assignee", default=DEFAULT_ASSIGNEE)
    parser.add_argument("--label", action="append", dest="labels")
    parser.add_argument("--milestone", type=int, default=DEFAULT_MILESTONE)
    parser.add_argument("--parent", type=int, default=DEFAULT_PARENT)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    if not isinstance(report, dict):
        parser.error("分析reportの形式が不正です")
    options = ExportOptions(
        create=args.create,
        approved_fingerprints=frozenset(args.approved_fingerprint),
        assignee=args.assignee,
        labels=tuple(args.labels or DEFAULT_LABELS),
        milestone=args.milestone,
        parent_number=args.parent,
    )
    results = export_clusters(report, GhIssueGateway(args.repo), options)
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
