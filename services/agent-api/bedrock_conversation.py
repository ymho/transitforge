from __future__ import annotations

import time
from typing import Any, Callable

from bedrock_tools import SYSTEM_PROMPT, TOOLS


def converse(
    bedrock_client: Any,
    messages: list[dict[str, Any]],
    model_id: str,
    request_id: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    log_event: Callable[..., None] | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    if request_id and log_event:
        log_event("bedrock_converse_started", request_id)
    result = bedrock_client.converse(
        modelId=model_id,
        system=[{"text": SYSTEM_PROMPT}],
        messages=messages,
        toolConfig={"tools": tools if tools is not None else TOOLS},
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
    if request_id and log_event:
        log_event(
            "bedrock_converse_completed",
            request_id,
            durationMs=round((time.perf_counter() - started) * 1000),
            stopReason=stop_reason,
        )
    measured_latency_ms = round((time.perf_counter() - started) * 1000)
    usage = result.get("usage")
    safe_usage = {
        key: int(usage[key])
        for key in ("inputTokens", "outputTokens", "totalTokens")
        if isinstance(usage, dict)
        and isinstance(usage.get(key), (int, float))
        and usage[key] >= 0
    }
    metrics = result.get("metrics")
    provider_latency = (
        metrics.get("latencyMs")
        if isinstance(metrics, dict)
        and isinstance(metrics.get("latencyMs"), (int, float))
        and metrics["latencyMs"] >= 0
        else measured_latency_ms
    )
    return {
        "message": message,
        "stopReason": stop_reason,
        "metadata": {
            "modelId": model_id,
            "latencyMs": round(provider_latency),
            **({"usage": safe_usage} if safe_usage else {}),
        },
    }
