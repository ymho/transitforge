from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from request_contract import RequestError


def store_feedback(
    value: dict[str, Any],
    bucket: str,
    s3_client: Any,
    now: datetime | None = None,
) -> dict[str, str]:
    if not bucket:
        raise RequestError(503, "フィードバック保存先を利用できません。")
    rating = value.get("rating")
    conversation = value.get("conversation")
    request_ids = value.get("requestIds", [])
    if rating not in {"good", "bad"} or not isinstance(conversation, list) or not conversation or len(conversation) > 50:
        raise RequestError(400, "フィードバックの形式が不正です。")
    if (
        not isinstance(request_ids, list)
        or len(request_ids) > 50
        or not all(
            isinstance(item, str) and 0 < len(item) <= 128
            for item in request_ids
        )
    ):
        raise RequestError(400, "リクエストIDの形式が不正です。")
    messages = []
    for item in conversation:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"} or not isinstance(item.get("text"), str):
            raise RequestError(400, "会話の形式が不正です。")
        text = item["text"].strip()
        if not text or len(text) > 4000:
            raise RequestError(400, "会話の文字数が不正です。")
        messages.append({"role": item["role"], "text": text})
    now = now or datetime.now(timezone.utc)
    feedback_id = str(uuid.uuid4())
    key = f"conversation-feedback/{now:%Y/%m/%d}/{feedback_id}.json"
    payload = {"schemaVersion": "conversation-feedback-v1", "feedbackId": feedback_id, "createdAt": now.isoformat(), "rating": rating, "requestIds": request_ids, "conversation": messages}
    s3_client.put_object(Bucket=bucket, Key=key, Body=json.dumps(payload, ensure_ascii=False).encode("utf-8"), ContentType="application/json", ServerSideEncryption="AES256")
    return {"feedbackId": feedback_id}
