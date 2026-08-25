from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from request_contract import RequestError

MAX_MESSAGES = 50
MAX_TEXT_LENGTH = 4000
MAX_REQUEST_IDS = 50
MAX_COMMENT_LENGTH = 1000
MAX_STORED_BYTES = 256 * 1024


def store_feedback(
    value: dict[str, Any],
    bucket: str,
    s3_client: Any,
    now: datetime | None = None,
) -> dict[str, str]:
    if not bucket:
        raise RequestError(503, "フィードバック保存先を利用できません。")
    schema_version = value.get("schemaVersion", "conversation-feedback-v1")
    if schema_version == "conversation-feedback-v1":
        payload_fields = _validated_v1(value)
    elif schema_version == "conversation-feedback-v2":
        payload_fields = _validated_v2(value)
    else:
        raise RequestError(400, "フィードバックのバージョンが不正です。")

    now = now or datetime.now(timezone.utc)
    feedback_id = str(uuid.uuid4())
    payload = {
        "schemaVersion": schema_version,
        "feedbackId": feedback_id,
        "createdAt": now.isoformat(),
        **payload_fields,
    }
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_STORED_BYTES:
        raise RequestError(413, "フィードバックの保存容量を超えています。")
    key = f"conversation-feedback/{now:%Y/%m/%d}/{feedback_id}.json"
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=encoded,
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    return {"feedbackId": feedback_id}


def _validated_v1(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "rating": _validated_rating(value),
        "requestIds": _validated_request_ids(value.get("requestIds", [])),
        "conversation": _validated_messages(
            value.get("conversation"), require_ids=False
        ),
    }


def _validated_v2(value: dict[str, Any]) -> dict[str, Any]:
    rating = _validated_rating(value)
    session_id = _validated_identifier(value.get("sessionId"), "会話ID")
    target_message_id = _validated_identifier(
        value.get("targetMessageId"), "対象メッセージID"
    )
    request_ids = _validated_request_ids(value.get("requestIds", []))
    messages = _validated_messages(value.get("conversation"), require_ids=True)
    target = messages[-1]
    if target["messageId"] != target_message_id or target["role"] != "assistant":
        raise RequestError(400, "評価対象の回答が会話末尾にありません。")
    message_request_ids = {
        message["requestId"] for message in messages if "requestId" in message
    }
    if not message_request_ids.issubset(set(request_ids)):
        raise RequestError(400, "リクエストIDと会話の対応が不正です。")

    comment = value.get("comment")
    if comment is not None:
        if rating != "bad" or not isinstance(comment, str):
            raise RequestError(400, "コメントの形式が不正です。")
        comment = comment.strip()
        if (
            not comment
            or len(comment) > MAX_COMMENT_LENGTH
            or any(
                ord(character) < 32 and character not in "\n\t"
                for character in comment
            )
        ):
            raise RequestError(400, "コメントの文字数または文字種が不正です。")

    return {
        "rating": rating,
        **({"comment": comment} if comment is not None else {}),
        "sessionId": session_id,
        "targetMessageId": target_message_id,
        "requestIds": request_ids,
        "conversation": messages,
    }


def _validated_rating(value: dict[str, Any]) -> str:
    rating = value.get("rating")
    if rating not in {"good", "bad"}:
        raise RequestError(400, "フィードバックの形式が不正です。")
    return rating


def _validated_request_ids(value: Any) -> list[str]:
    if (
        not isinstance(value, list)
        or len(value) > MAX_REQUEST_IDS
        or not all(
            isinstance(item, str) and 0 < len(item) <= 128 for item in value
        )
    ):
        raise RequestError(400, "リクエストIDの形式が不正です。")
    return value


def _validated_messages(value: Any, require_ids: bool) -> list[dict[str, str]]:
    if not isinstance(value, list) or not value or len(value) > MAX_MESSAGES:
        raise RequestError(400, "フィードバックの形式が不正です。")
    messages = []
    seen_ids = set()
    for item in value:
        if (
            not isinstance(item, dict)
            or item.get("role") not in {"user", "assistant"}
            or not isinstance(item.get("text"), str)
        ):
            raise RequestError(400, "会話の形式が不正です。")
        text = item["text"].strip()
        if not text or len(text) > MAX_TEXT_LENGTH:
            raise RequestError(400, "会話の文字数が不正です。")
        message = {"role": item["role"], "text": text}
        if require_ids:
            message_id = _validated_identifier(
                item.get("messageId"), "メッセージID"
            )
            if message_id in seen_ids:
                raise RequestError(400, "メッセージIDが重複しています。")
            seen_ids.add(message_id)
            message = {"messageId": message_id, **message}
            request_id = item.get("requestId")
            if request_id is not None:
                message["requestId"] = _validated_identifier(
                    request_id, "リクエストID", 128
                )
        messages.append(message)
    return messages


def _validated_identifier(value: Any, label: str, limit: int = 100) -> str:
    if not isinstance(value, str) or not value or len(value) > limit:
        raise RequestError(400, f"{label}の形式が不正です。")
    return value
