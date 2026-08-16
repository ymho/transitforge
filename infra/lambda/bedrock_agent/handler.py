from __future__ import annotations

import os
import json
import time
import uuid
from typing import Any

import journey_search
import representative_timetable
from bedrock_tools import SYSTEM_PROMPT, TOOLS
from congestion_analysis import (
    query_daily_congestion_analysis,
    query_daily_congestion_peak,
)
from delay_analysis import query_train_delay_analysis
from operation_dispatcher import OperationConfig, dispatch, handles
from conversation_feedback import store_feedback
from request_contract import (
    RequestError,
    request_messages,
    request_value,
    response,
    validated_messages,
)


MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")
SUMMARY_TABLE = os.environ.get("SUMMARY_TABLE", "")
DELAY_SUMMARY_TABLE = os.environ.get("DELAY_SUMMARY_TABLE", "")
AI_TIMETABLE_BUCKET = os.environ.get("AI_TIMETABLE_BUCKET", "")
AI_TIMETABLE_PREFIX = os.environ.get("AI_TIMETABLE_PREFIX", "ai-timetable")
PLANNING_TIMETABLE_PREFIX = os.environ.get("PLANNING_TIMETABLE_PREFIX", "timetable")
TRAFFIC_SNAPSHOT_BUCKET = os.environ.get("TRAFFIC_SNAPSHOT_BUCKET", "")
TRAFFIC_SNAPSHOT_KEY = os.environ.get(
    "TRAFFIC_SNAPSHOT_KEY", "api/traffic/delays.json"
)
TRAVEL_PROVIDER_SECRET_ARN = os.environ.get("TRAVEL_PROVIDER_SECRET_ARN", "")
CONVERSATION_FEEDBACK_BUCKET = os.environ.get("CONVERSATION_FEEDBACK_BUCKET", "")
OPERATION_CONFIG = OperationConfig(
    summary_table=SUMMARY_TABLE,
    delay_summary_table=DELAY_SUMMARY_TABLE,
    timetable_bucket=AI_TIMETABLE_BUCKET,
    timetable_prefix=AI_TIMETABLE_PREFIX,
    planning_timetable_prefix=PLANNING_TIMETABLE_PREFIX,
    traffic_snapshot_bucket=TRAFFIC_SNAPSHOT_BUCKET,
    traffic_snapshot_key=TRAFFIC_SNAPSHOT_KEY,
    travel_provider_secret_arn=TRAVEL_PROVIDER_SECRET_ARN,
)


def log_event(event: str, request_id: str, **fields: Any) -> None:
    print(json.dumps({"event": event, "requestId": request_id, **fields}, ensure_ascii=False))


def converse(
    bedrock_client: Any,
    messages: list[dict[str, Any]],
    request_id: str | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    if request_id:
        log_event("bedrock_converse_started", request_id)
    result = bedrock_client.converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=messages,
        toolConfig={"tools": TOOLS},
        inferenceConfig={"maxTokens": 500, "temperature": 0},
    )
    message = result.get("output", {}).get("message")
    stop_reason = result.get("stopReason")
    if not isinstance(message, dict) or stop_reason not in {
        "end_turn",
        "tool_use",
        "max_tokens",
    }:
        raise RuntimeError("Bedrock returned an unexpected response")
    if request_id:
        log_event(
            "bedrock_converse_completed",
            request_id,
            durationMs=round((time.perf_counter() - started) * 1000),
            stopReason=stop_reason,
        )
    return {"message": message, "stopReason": stop_reason}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    request_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    started = time.perf_counter()
    try:
        value = request_value(event)
        operation = value.get("operation", "bedrock_converse")
        log_event("agent_request_started", request_id, operation=operation)
        if operation == "conversation_feedback":
            import boto3
            result = store_feedback(value, CONVERSATION_FEEDBACK_BUCKET, boto3.client("s3"))
            log_event("conversation_feedback_stored", request_id, rating=value.get("rating"), feedbackId=result["feedbackId"])
            return response(200, result, request_id)
        if handles(value):
            import boto3

            dispatch_started = time.perf_counter()
            result = dispatch(
                value,
                OPERATION_CONFIG,
                s3_client=lambda: boto3.client("s3"),
                dynamodb_client=lambda: boto3.client("dynamodb"),
                secrets_manager_client=lambda: boto3.client("secretsmanager"),
                request_id=request_id,
                log_event=log_event,
            )
            log_event("agent_request_completed", request_id, operation=operation, durationMs=round((time.perf_counter() - dispatch_started) * 1000))
            return response(200, result, request_id)
        messages = validated_messages(value)
    except RequestError as error:
        log_event("agent_request_rejected", request_id, statusCode=error.status_code)
        return response(error.status_code, {"message": str(error)}, request_id)

    import boto3

    result = converse(boto3.client("bedrock-runtime"), messages, request_id)
    log_event("agent_request_completed", request_id, operation="bedrock_converse", durationMs=round((time.perf_counter() - started) * 1000))
    return response(200, result, request_id)
