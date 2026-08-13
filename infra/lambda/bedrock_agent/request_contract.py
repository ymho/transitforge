from __future__ import annotations

import base64
import json
from typing import Any

MAX_BODY_BYTES = 32 * 1024
MAX_MESSAGES = 16
MAX_CONTENT_BLOCKS = 12
MAX_TEXT_CHARACTERS = 4_000
ALLOWED_TOOL_NAMES = {
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
}


class RequestError(ValueError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def response(status_code: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        },
        "body": json.dumps(body, ensure_ascii=False, separators=(",", ":")),
    }


def request_messages(event: dict[str, Any]) -> list[dict[str, Any]]:
    return validated_messages(request_value(event))


def request_value(event: dict[str, Any]) -> dict[str, Any]:
    if event.get("requestContext", {}).get("http", {}).get("method") != "POST":
        raise RequestError(405, "POSTのみ利用できます。")
    raw_body = event.get("body")
    if not isinstance(raw_body, str):
        raise RequestError(400, "リクエスト本文が必要です。")
    if event.get("isBase64Encoded") is True:
        try:
            body = base64.b64decode(raw_body, validate=True)
        except ValueError as error:
            raise RequestError(400, "リクエスト本文を読み取れません。") from error
    else:
        body = raw_body.encode("utf-8")
    if len(body) > MAX_BODY_BYTES:
        raise RequestError(413, "リクエストが大きすぎます。")
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestError(400, "JSON形式のリクエストが必要です。") from error
    if not isinstance(value, dict):
        raise RequestError(400, "リクエストの形式が不正です。")
    return value


def validated_messages(value: dict[str, Any]) -> list[dict[str, Any]]:
    messages = value.get("messages")
    if not isinstance(messages, list) or not messages or len(messages) > MAX_MESSAGES:
        raise RequestError(400, "messagesの件数が不正です。")
    return [_validated_message(message) for message in messages]


def _validated_message(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("role") not in {"user", "assistant"}:
        raise RequestError(400, "messageのroleが不正です。")
    content = value.get("content")
    if (
        not isinstance(content, list)
        or not content
        or len(content) > MAX_CONTENT_BLOCKS
    ):
        raise RequestError(400, "messageのcontentが不正です。")
    role = value["role"]
    return {
        "role": role,
        "content": [_validated_content_block(block, role) for block in content],
    }


def _validated_content_block(value: Any, role: str) -> dict[str, Any]:
    if not isinstance(value, dict) or len(value) != 1:
        raise RequestError(400, "content blockの形式が不正です。")
    if "text" in value:
        text = value["text"]
        if isinstance(text, str) and 0 < len(text) <= MAX_TEXT_CHARACTERS:
            return {"text": text}
    if "toolUse" in value and role == "assistant":
        tool_use = value["toolUse"]
        if (
            isinstance(tool_use, dict)
            and isinstance(tool_use.get("toolUseId"), str)
            and tool_use.get("name") in ALLOWED_TOOL_NAMES
            and isinstance(tool_use.get("input"), dict)
        ):
            return {
                "toolUse": {
                    "toolUseId": tool_use["toolUseId"][:128],
                    "name": tool_use["name"],
                    "input": tool_use["input"],
                }
            }
    if "toolResult" in value and role == "user":
        tool_result = value["toolResult"]
        if (
            isinstance(tool_result, dict)
            and isinstance(tool_result.get("toolUseId"), str)
            and tool_result.get("status") in {"success", "error"}
            and _valid_tool_result_content(tool_result.get("content"))
        ):
            return {
                "toolResult": {
                    "toolUseId": tool_result["toolUseId"][:128],
                    "status": tool_result["status"],
                    "content": tool_result["content"],
                }
            }
    raise RequestError(400, "許可されていないcontent blockです。")


def _valid_tool_result_content(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 1:
        return False
    block = value[0]
    if not isinstance(block, dict) or len(block) != 1 or "json" not in block:
        return False
    try:
        encoded = json.dumps(block["json"], ensure_ascii=False, separators=(",", ":"))
        return len(encoded) <= 8_000
    except (TypeError, ValueError):
        return False
