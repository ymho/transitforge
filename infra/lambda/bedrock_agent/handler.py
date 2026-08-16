from __future__ import annotations

import os
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
OPERATION_CONFIG = OperationConfig(
    summary_table=SUMMARY_TABLE,
    delay_summary_table=DELAY_SUMMARY_TABLE,
    timetable_bucket=AI_TIMETABLE_BUCKET,
    timetable_prefix=AI_TIMETABLE_PREFIX,
    planning_timetable_prefix=PLANNING_TIMETABLE_PREFIX,
    traffic_snapshot_bucket=TRAFFIC_SNAPSHOT_BUCKET,
    traffic_snapshot_key=TRAFFIC_SNAPSHOT_KEY,
)


def converse(bedrock_client: Any, messages: list[dict[str, Any]]) -> dict[str, Any]:
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
    return {"message": message, "stopReason": stop_reason}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        value = request_value(event)
        if handles(value):
            import boto3

            result = dispatch(
                value,
                OPERATION_CONFIG,
                s3_client=lambda: boto3.client("s3"),
                dynamodb_client=lambda: boto3.client("dynamodb"),
            )
            return response(200, result)
        messages = validated_messages(value)
    except RequestError as error:
        return response(error.status_code, {"message": str(error)})

    import boto3

    result = converse(boto3.client("bedrock-runtime"), messages)
    return response(200, result)
