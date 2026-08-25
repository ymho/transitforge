#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

REPORT_SCHEMA = "conversation-feedback-analysis-v1"
DEFAULT_LIMIT = 200
MAX_LIMIT = 500


@dataclass(frozen=True)
class Finding:
    feedback_id: str
    created_at: str
    request_ids: tuple[str, ...]
    feature: str
    intent: str
    symptom: str
    expected: str
    severity: str
    signature: frozenset[str]


def analyze_feedback(values: Iterable[dict[str, Any]]) -> dict[str, Any]:
    findings = [finding for value in values if (finding := classify(value))]
    clusters: list[list[Finding]] = []
    for finding in sorted(findings, key=lambda item: (item.created_at, item.feedback_id)):
        target = next(
            (
                cluster for cluster in clusters
                if similar(finding, cluster[0])
            ),
            None,
        )
        (target if target is not None else clusters.append([finding]))
        if target is not None:
            target.append(finding)

    output_clusters = [cluster_report(cluster) for cluster in clusters]
    output_clusters.sort(key=lambda item: (-item["count"], item["fingerprint"]))
    return {
        "schemaVersion": REPORT_SCHEMA,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "feedbackCount": len(findings),
        "clusterCount": len(output_clusters),
        "clusters": output_clusters,
    }


def classify(value: dict[str, Any]) -> Finding | None:
    if value.get("rating") != "bad":
        return None
    feedback_id = safe_identifier(value.get("feedbackId"))
    created_at = value.get("createdAt")
    if feedback_id is None or not isinstance(created_at, str):
        return None
    text = feedback_text(value)
    feature = match_category(text, FEATURE_RULES, "unknown")
    intent = match_category(text, INTENT_RULES, "unknown")
    symptom = match_category(text, SYMPTOM_RULES, "other")
    signature = frozenset((feature, intent, symptom))
    return Finding(
        feedback_id=feedback_id,
        created_at=created_at,
        request_ids=tuple(
            request_id for candidate in value.get("requestIds", [])[:50]
            if (request_id := safe_identifier(candidate, 128)) is not None
        ) if isinstance(value.get("requestIds"), list) else (),
        feature=feature,
        intent=intent,
        symptom=symptom,
        expected=EXPECTED_BY_SYMPTOM[symptom],
        severity=SEVERITY_BY_SYMPTOM[symptom],
        signature=signature,
    )


def similar(left: Finding, right: Finding) -> bool:
    if left.signature == right.signature:
        return True
    intersection = len(left.signature & right.signature)
    union = len(left.signature | right.signature)
    return union > 0 and intersection / union >= 0.8


def cluster_report(cluster: list[Finding]) -> dict[str, Any]:
    representative = cluster[0]
    fingerprint = hashlib.sha256(
        "|".join(sorted(representative.signature)).encode("utf-8")
    ).hexdigest()[:16]
    dates = sorted(item.created_at for item in cluster)
    return {
        "fingerprint": fingerprint,
        "title": f"{FEATURE_LABELS[representative.feature]}で{SYMPTOM_LABELS[representative.symptom]}",
        "feature": representative.feature,
        "intent": representative.intent,
        "symptom": representative.symptom,
        "expected": representative.expected,
        "severity": representative.severity,
        "count": len(cluster),
        "firstSeenAt": dates[0],
        "lastSeenAt": dates[-1],
        "evidence": {
            "feedbackIds": [item.feedback_id for item in cluster],
            "requestIds": sorted({
                request_id for item in cluster for request_id in item.request_ids
            }),
        },
    }


def feedback_text(value: dict[str, Any]) -> str:
    parts = []
    comment = value.get("comment")
    if isinstance(comment, str):
        parts.append(comment)
    conversation = value.get("conversation")
    if isinstance(conversation, list):
        for message in conversation[-6:]:
            if isinstance(message, dict) and isinstance(message.get("text"), str):
                parts.append(message["text"])
    return redact("\n".join(parts)).lower()


def redact(value: str) -> str:
    redacted = value
    for pattern in PRIVATE_PATTERNS:
        redacted = pattern.sub("[redacted]", redacted)
    return redacted[:24_000]


def load_local_feedback(
    directory: Path,
    start: date,
    end: date,
    limit: int,
) -> list[dict[str, Any]]:
    values = []
    for path in sorted(directory.rglob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(value, dict) and within_period(value, start, end):
            values.append(value)
        if len(values) >= limit:
            break
    return values


def load_s3_feedback(
    bucket: str,
    prefix: str,
    start: date,
    end: date,
    limit: int,
) -> list[dict[str, Any]]:
    import boto3  # type: ignore[import-not-found]

    client = boto3.client("s3")
    values = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            key = item.get("Key")
            if not isinstance(key, str) or not key.endswith(".json"):
                continue
            body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
            try:
                value = json.loads(body)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(value, dict) and within_period(value, start, end):
                values.append(value)
            if len(values) >= limit:
                return values
    return values


def within_period(value: dict[str, Any], start: date, end: date) -> bool:
    created_at = value.get("createdAt")
    if not isinstance(created_at, str):
        return False
    try:
        created_date = datetime.fromisoformat(created_at.replace("Z", "+00:00")).date()
    except ValueError:
        return False
    return start <= created_date <= end


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# 会話フィードバック分析",
        "",
        f"- 対象Feedback: {report['feedbackCount']}件",
        f"- Cluster: {report['clusterCount']}件",
        "",
    ]
    for cluster in report["clusters"]:
        lines.extend([
            f"## {cluster['title']}",
            "",
            f"- Fingerprint: `{cluster['fingerprint']}`",
            f"- 件数: {cluster['count']}",
            f"- 期間: {cluster['firstSeenAt']} 〜 {cluster['lastSeenAt']}",
            f"- 重大度: {cluster['severity']}",
            f"- 期待結果: {cluster['expected']}",
            f"- Feedback ID: {', '.join(cluster['evidence']['feedbackIds'])}",
            f"- Request ID: {', '.join(cluster['evidence']['requestIds']) or 'なし'}",
            "",
        ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="非公開の会話Feedbackを匿名化した課題clusterへ集約する"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input-dir", type=Path)
    source.add_argument("--bucket")
    parser.add_argument("--prefix", default="conversation-feedback/")
    parser.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-markdown", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.start > args.end or not 1 <= args.limit <= MAX_LIMIT:
        parser.error("日付範囲または件数上限が不正です")

    values = load_local_feedback(args.input_dir, args.start, args.end, args.limit) \
        if args.input_dir else load_s3_feedback(
            args.bucket, args.prefix, args.start, args.end, args.limit
        )
    report = analyze_feedback(values)
    if args.output_json:
        args.output_json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    if args.output_markdown:
        args.output_markdown.write_text(markdown_report(report), encoding="utf-8")
    mode = "dry-run" if args.dry_run else "analysis"
    print(
        f"{mode}: feedback={report['feedbackCount']} clusters={report['clusterCount']}"
    )
    return 0


def match_category(
    text: str,
    rules: tuple[tuple[str, tuple[str, ...]], ...],
    fallback: str,
) -> str:
    return next(
        (category for category, words in rules if any(word in text for word in words)),
        fallback,
    )


def safe_identifier(value: Any, limit: int = 100) -> str | None:
    return value if isinstance(value, str) and 0 < len(value) <= limit else None


PRIVATE_PATTERNS = (
    re.compile(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", re.IGNORECASE),
    re.compile(r"\b(?:\+?81[- ]?)?0\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4}\b"),
    re.compile(r"\b(?:bearer|token|api[_ -]?key)\s*[:= ]\s*[^\s]+", re.IGNORECASE),
    re.compile(r"\b-?\d{1,3}\.\d{4,}\s*[,/]\s*-?\d{1,3}\.\d{4,}\b"),
)
FEATURE_RULES = (
    ("accommodation", ("宿", "ホテル", "旅館", "空室")),
    ("journey", ("経路", "乗換", "列車", "新幹線", "特急", "駅")),
    ("itinerary", ("旅程", "旅行計画", "観光")),
    ("viewer", ("地図", "表示", "ボタン", "タブ", "画面")),
    ("conversation", ("会話", "回答", "チャット", "コンシェルジュ")),
)
INTENT_RULES = (
    ("travel-planning", ("旅行", "旅程", "観光", "宿")),
    ("route-search", ("経路", "乗換", "行きたい", "列車")),
    ("viewer-operation", ("地図", "表示", "フォーカス", "ボタン")),
    ("settings", ("設定", "プロフィール")),
)
SYMPTOM_RULES = (
    ("failure", ("失敗", "エラー", "できません", "動かない", "押せない")),
    ("incorrect", ("違う", "誤", "おかしい", "反映され", "間違")),
    ("missing", ("出ない", "消え", "ない", "不足", "欠け")),
    ("duplicate", ("重複", "二重", "何度も", "同じもの")),
    ("slow", ("遅い", "時間がかか", "重い")),
    ("unclear", ("わかりにく", "不自然", "違和感", "見づら")),
)
EXPECTED_BY_SYMPTOM = {
    "failure": "対象操作がエラーなく完了する",
    "incorrect": "入力条件と決定論的な結果が一致する",
    "missing": "必要な情報または操作対象が欠落せず表示される",
    "duplicate": "同じ内容が重複せず一度だけ処理される",
    "slow": "利用者を待たせない時間内に処理が完了する",
    "unclear": "次に行う操作と結果を迷わず理解できる",
    "other": "利用者の意図に沿う結果を返す",
}
SEVERITY_BY_SYMPTOM = {
    "failure": "high",
    "incorrect": "medium",
    "missing": "medium",
    "duplicate": "low",
    "slow": "medium",
    "unclear": "low",
    "other": "low",
}
FEATURE_LABELS = {
    "accommodation": "宿泊検索",
    "journey": "経路検索",
    "itinerary": "旅程",
    "viewer": "Viewer",
    "conversation": "会話",
    "unknown": "未分類機能",
}
SYMPTOM_LABELS = {
    "failure": "操作が完了しない",
    "incorrect": "条件と異なる結果になる",
    "missing": "必要な情報が欠落する",
    "duplicate": "同じ内容が重複する",
    "slow": "応答に時間がかかる",
    "unclear": "操作や表示が分かりにくい",
    "other": "意図に沿わない結果になる",
}


if __name__ == "__main__":
    raise SystemExit(main())
