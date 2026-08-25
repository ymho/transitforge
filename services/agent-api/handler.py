from __future__ import annotations

import json
import os
import uuid
from typing import Any

# 既存testとLambda handler名の互換性を保つ公開import
import journey_search
import representative_timetable
from congestion_analysis import (
    query_daily_congestion_analysis,
    query_daily_congestion_peak,
)
from delay_analysis import query_train_delay_analysis
from agent_application import (
    AgentApplicationConfig,
    AgentApplicationDependencies,
    execute,
)
from bedrock_conversation import converse as _converse
from operation_dispatcher import OperationConfig
from request_contract import (
    RequestError,
    request_messages,
    request_value,
    response,
    validated_messages,
    validated_tool_definitions,
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
AGENT_TRACE_BUCKET = os.environ.get("AGENT_TRACE_BUCKET", "")
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
    tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return _converse(
        bedrock_client,
        messages,
        MODEL_ID,
        request_id,
        tools,
        log_event,
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    request_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    try:
        value = request_value(event)
        import boto3

        status, body = execute(
            value,
            request_id,
            AgentApplicationConfig(
                model_id=MODEL_ID,
                operation=OPERATION_CONFIG,
                conversation_feedback_bucket=CONVERSATION_FEEDBACK_BUCKET,
                agent_trace_bucket=AGENT_TRACE_BUCKET,
            ),
            AgentApplicationDependencies(
                s3_client=lambda: boto3.client("s3"),
                dynamodb_client=lambda: boto3.client("dynamodb"),
                secrets_manager_client=lambda: boto3.client("secretsmanager"),
                bedrock_client=lambda: boto3.client("bedrock-runtime"),
                converse=_converse,
            ),
            log_event,
        )
        return response(status, body, request_id)
    except RequestError as error:
        log_event("agent_request_rejected", request_id, statusCode=error.status_code)
        return response(error.status_code, {"message": str(error)}, request_id)
