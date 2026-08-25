from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable

from agent_trace_storage import store_agent_trace
from conversation_feedback import store_feedback
from operation_dispatcher import OperationConfig, dispatch, handles
from request_contract import RequestError, validated_messages, validated_tool_definitions


@dataclass(frozen=True)
class AgentApplicationDependencies:
    s3_client: Callable[[], Any]
    dynamodb_client: Callable[[], Any]
    secrets_manager_client: Callable[[], Any]
    bedrock_client: Callable[[], Any]
    converse: Callable[..., dict[str, Any]]


@dataclass(frozen=True)
class AgentApplicationConfig:
    model_id: str
    operation: OperationConfig
    conversation_feedback_bucket: str
    agent_trace_bucket: str


def execute(
    value: dict[str, Any],
    request_id: str,
    config: AgentApplicationConfig,
    dependencies: AgentApplicationDependencies,
    log_event: Callable[..., None],
) -> tuple[int, dict[str, Any]]:
    started = time.perf_counter()
    operation = value.get("operation", "bedrock_converse")
    log_event("agent_request_started", request_id, operation=operation)
    if operation == "conversation_feedback":
        try:
            result = store_feedback(
                value,
                config.conversation_feedback_bucket,
                dependencies.s3_client(),
            )
        except RequestError:
            raise
        except Exception:
            log_event(
                "conversation_feedback_store_failed",
                request_id,
                durationMs=round((time.perf_counter() - started) * 1000),
            )
            return 503, {"message": "会話フィードバックを保存できませんでした。"}
        log_event(
            "conversation_feedback_stored",
            request_id,
            rating=value.get("rating"),
            feedbackId=result["feedbackId"],
            messageCount=len(value.get("conversation", [])),
            relatedRequestCount=len(value.get("requestIds", [])),
            durationMs=round((time.perf_counter() - started) * 1000),
        )
        return 200, result
    if operation == "agent_trace":
        try:
            result = store_agent_trace(
                value,
                config.agent_trace_bucket,
                dependencies.s3_client(),
            )
        except RequestError:
            raise
        except Exception:
            log_event(
                "agent_trace_store_failed",
                request_id,
                durationMs=round((time.perf_counter() - started) * 1000),
            )
            return 503, {"message": "Agent Traceを保存できませんでした。"}
        log_event(
            "agent_trace_stored",
            request_id,
            traceId=result["traceId"],
            taskId=value.get("taskId"),
            eventCount=result["eventCount"],
            relatedRequestCount=len(value.get("requestIds", [])),
            durationMs=round((time.perf_counter() - started) * 1000),
        )
        return 200, result
    if handles(value):
        dispatch_started = time.perf_counter()
        result = dispatch(
            value,
            config.operation,
            s3_client=dependencies.s3_client,
            dynamodb_client=dependencies.dynamodb_client,
            secrets_manager_client=dependencies.secrets_manager_client,
            request_id=request_id,
            log_event=log_event,
        )
        log_event(
            "agent_request_completed",
            request_id,
            operation=operation,
            durationMs=round((time.perf_counter() - dispatch_started) * 1000),
        )
        return 200, result or {}

    result = dependencies.converse(
        dependencies.bedrock_client(),
        validated_messages(value),
        config.model_id,
        request_id,
        validated_tool_definitions(value),
        log_event,
    )
    log_event(
        "agent_request_completed",
        request_id,
        operation="bedrock_converse",
        durationMs=round((time.perf_counter() - started) * 1000),
    )
    return 200, result
