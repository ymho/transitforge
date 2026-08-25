from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from request_contract import RequestError


MAX_TRACE_EVENTS = 100
MAX_TRACE_PAYLOAD_BYTES = 24 * 1024
MAX_REQUEST_IDS = 10
MAX_TEXT_CHARACTERS = 512
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SECRET_KEY = re.compile(
    r"(?:authorization|cookie|password|secret|token|api[_-]?key|credential)",
    re.IGNORECASE,
)
LOCATION_KEY = re.compile(
    r"^(?:lat|latitude|lng|lon|longitude|coordinates?|currentLocation)$",
    re.IGNORECASE,
)
BEARER_VALUE = re.compile(r"bearer\s+[a-z0-9._~+/=-]+", re.IGNORECASE)
KEY_VALUE_SECRET = re.compile(
    r"((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+",
    re.IGNORECASE,
)
COORDINATE_PAIR = re.compile(
    r"(?<!\d)-?\d{1,2}\.\d+\s*[,/]\s*-?\d{1,3}\.\d+(?!\d)"
)
LABELED_COORDINATE = re.compile(
    r"(?:緯度|経度|latitude|longitude)\s*[:=]?\s*-?\d{1,3}(?:\.\d+)?",
    re.IGNORECASE,
)

EVENT_FIELDS: dict[str, tuple[set[str], set[str]]] = {
    "task_started": ({"userRequest"}, set()),
    "intent_normalized": ({"intent", "constraints"}, set()),
    "plan_created": ({"steps"}, set()),
    "tool_called": ({"toolCallId", "toolName", "input"}, set()),
    "tool_completed": (
        {"toolCallId", "toolName", "outcome", "result"},
        {"latencyMs", "errorCode", "retryable"},
    ),
    "evidence_collected": (
        {"evidenceIds", "categories", "sourceTypes"},
        set(),
    ),
    "replan_decided": ({"changed", "reason", "steps"}, set()),
    "model_completed": (
        {"provider"},
        {
            "requestId",
            "model",
            "latencyMs",
            "inputTokens",
            "outputTokens",
            "totalTokens",
        },
    ),
    "response_generated": ({"response", "claimIds"}, set()),
    "viewer_action": (
        {"actionType", "status"},
        {"targetEntityId", "reason"},
    ),
    "task_completed": ({"status"}, {"latencyMs", "reason"}),
}

STRING_FIELDS = {
    "userRequest",
    "intent",
    "toolCallId",
    "toolName",
    "errorCode",
    "provider",
    "requestId",
    "model",
    "reason",
    "response",
    "actionType",
    "targetEntityId",
}
STRING_LIST_FIELDS = {
    "steps",
    "evidenceIds",
    "categories",
    "sourceTypes",
    "claimIds",
}
COUNT_FIELDS = {
    "sequence",
    "latencyMs",
    "inputTokens",
    "outputTokens",
    "totalTokens",
}
PAYLOAD_FIELDS = {"constraints", "input", "result"}


def store_agent_trace(
    value: dict[str, Any],
    bucket: str,
    s3_client: Any,
    now: datetime | None = None,
) -> dict[str, str | int]:
    if not bucket:
        raise RequestError(503, "Agent Trace保存先を利用できません。")
    if set(value) - {"operation", "taskId", "requestIds", "trace"}:
        raise RequestError(400, "Agent Trace送信fieldが不正です。")
    if "operation" in value and value["operation"] != "agent_trace":
        raise RequestError(400, "Agent Trace operationが不正です。")
    task_id = _identifier(value.get("taskId"), "taskId")
    request_ids = _request_ids(value.get("requestIds", []))
    trace = _validated_trace(value.get("trace"))
    created_at = now or datetime.now(timezone.utc)
    trace_id = str(uuid.uuid4())
    payload = {
        "schemaVersion": "agent-trace-submission-v1",
        "traceId": trace_id,
        "taskId": task_id,
        "executionId": trace["executionId"],
        "createdAt": created_at.isoformat(),
        "requestIds": request_ids,
        "trace": trace,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > MAX_TRACE_PAYLOAD_BYTES:
        raise RequestError(413, "Agent Traceが大きすぎます。")
    key = f"agent-traces/{created_at:%Y/%m/%d}/{task_id}/{trace_id}.json"
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=encoded,
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    return {"traceId": trace_id, "eventCount": len(trace["events"])}


def _validated_trace(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "executionId",
        "events",
        "droppedEventCount",
    }:
        raise RequestError(400, "Agent Traceの形式が不正です。")
    execution_id = _identifier(value["executionId"], "executionId")
    dropped = value["droppedEventCount"]
    events = value["events"]
    if not isinstance(dropped, int) or isinstance(dropped, bool) or dropped < 0:
        raise RequestError(400, "droppedEventCountが不正です。")
    if (
        not isinstance(events, list)
        or not events
        or len(events) > MAX_TRACE_EVENTS
    ):
        raise RequestError(400, "Agent Trace eventの件数が不正です。")
    validated = [_validated_event(event, index + 1) for index, event in enumerate(events)]
    previous_sequence = 0
    for event in validated:
        if event["sequence"] <= previous_sequence:
            raise RequestError(400, "Agent Trace eventの順序が不正です。")
        previous_sequence = event["sequence"]
    return {
        "executionId": execution_id,
        "events": validated,
        "droppedEventCount": dropped,
    }


def _validated_event(value: Any, position: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestError(400, f"Agent Trace event {position}件目が不正です。")
    event_type = value.get("type")
    fields = EVENT_FIELDS.get(event_type) if isinstance(event_type, str) else None
    if fields is None:
        raise RequestError(400, f"Agent Trace event {position}件目のtypeが不正です。")
    required, optional = fields
    allowed = {"type", "sequence", "occurredAt"} | required | optional
    if set(value) - allowed or not required.issubset(value):
        raise RequestError(400, f"Agent Trace event {position}件目のfieldが不正です。")
    sequence = value.get("sequence")
    occurred_at = value.get("occurredAt")
    if (
        not isinstance(sequence, int)
        or isinstance(sequence, bool)
        or sequence < 1
        or not _is_timestamp(occurred_at)
    ):
        raise RequestError(400, f"Agent Trace event {position}件目の共通fieldが不正です。")
    result: dict[str, Any] = {
        "type": event_type,
        "sequence": sequence,
        "occurredAt": occurred_at,
    }
    for key in required | optional:
        if key not in value:
            continue
        result[key] = _validated_event_field(key, value[key], event_type, position)
    return result


def _validated_event_field(
    key: str,
    value: Any,
    event_type: str,
    position: int,
) -> Any:
    if key in STRING_FIELDS:
        if not isinstance(value, str) or not value or len(value) > MAX_TEXT_CHARACTERS:
            raise RequestError(400, f"Agent Trace event {position}件目の{key}が不正です。")
        return _sanitize_string(value)
    if key in STRING_LIST_FIELDS:
        if (
            not isinstance(value, list)
            or len(value) > 20
            or not all(
                isinstance(item, str) and 0 < len(item) <= 160
                for item in value
            )
        ):
            raise RequestError(400, f"Agent Trace event {position}件目の{key}が不正です。")
        return [_sanitize_string(item) for item in value]
    if key in COUNT_FIELDS:
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or value < 0
        ):
            raise RequestError(400, f"Agent Trace event {position}件目の{key}が不正です。")
        return value
    if key in PAYLOAD_FIELDS:
        return _validated_payload_summary(value, position)
    if key in {"changed", "retryable"}:
        if not isinstance(value, bool):
            raise RequestError(400, f"Agent Trace event {position}件目の{key}が不正です。")
        return value
    if key == "outcome" and value in {"success", "error"}:
        return value
    if key == "status":
        allowed = (
            {"proposed", "applied", "rejected"}
            if event_type == "viewer_action"
            else {"completed", "failed", "cancelled"}
        )
        if value in allowed:
            return value
    raise RequestError(400, f"Agent Trace event {position}件目の{key}が不正です。")


def _validated_payload_summary(value: Any, position: int) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "byteLength",
        "truncated",
        "value",
    }:
        raise RequestError(400, f"Agent Trace event {position}件目のpayloadが不正です。")
    byte_length = value["byteLength"]
    if (
        not isinstance(byte_length, int)
        or isinstance(byte_length, bool)
        or byte_length < 0
        or not isinstance(value["truncated"], bool)
    ):
        raise RequestError(400, f"Agent Trace event {position}件目のpayloadが不正です。")
    return {
        "byteLength": byte_length,
        "truncated": value["truncated"],
        "value": _sanitize_value(value["value"], 0),
    }


def _sanitize_value(value: Any, depth: int) -> Any:
    if depth >= 5:
        return "[depth-limited]"
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if value == value and abs(value) != float("inf") else None
    if isinstance(value, str):
        return _sanitize_string(value[:MAX_TEXT_CHARACTERS])
    if isinstance(value, list):
        return [_sanitize_value(item, depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, nested in list(value.items())[:20]:
            safe_key = str(key)[:80]
            if SECRET_KEY.search(safe_key):
                result[safe_key] = "[redacted]"
            elif LOCATION_KEY.match(safe_key):
                result[safe_key] = "[location-redacted]"
            else:
                result[safe_key] = _sanitize_value(nested, depth + 1)
        return result
    return f"[{type(value).__name__}]"


def _sanitize_string(value: str) -> str:
    result = BEARER_VALUE.sub("Bearer [redacted]", value)
    result = KEY_VALUE_SECRET.sub(r"\1[redacted]", result)
    result = COORDINATE_PAIR.sub("[location-redacted]", result)
    return LABELED_COORDINATE.sub("[location-redacted]", result)


def _request_ids(value: Any) -> list[str]:
    if (
        not isinstance(value, list)
        or len(value) > MAX_REQUEST_IDS
        or not all(isinstance(item, str) and IDENTIFIER.fullmatch(item) for item in value)
        or len(set(value)) != len(value)
    ):
        raise RequestError(400, "requestIdsの形式が不正です。")
    return value


def _identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise RequestError(400, f"{name}の形式が不正です。")
    return value


def _is_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or len(value) > 40:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.tzinfo is not None
    except ValueError:
        return False
