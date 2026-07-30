from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime
from decimal import Decimal
from typing import Any

MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")
SUMMARY_TABLE = os.environ.get("SUMMARY_TABLE", "")
MAX_BODY_BYTES = 32 * 1024
MAX_MESSAGES = 16
MAX_CONTENT_BLOCKS = 12
MAX_TEXT_CHARACTERS = 4_000
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SYSTEM_PROMPT = """\
あなたはTransitForgeのAI運行観察員です。日本語で簡潔に案内してください。
利用者が列車を探したい場合はsearch_trainsを使い、その結果のserviceUidだけを
focus_trainへ渡してください。時刻の変更はset_display_timeを使ってください。
時刻変更と列車検索が同じ依頼に含まれる場合は、時刻を変更して結果を受け取ってから
列車を検索してください。時刻変更だけの依頼ではsearch_trainsを呼ばないでください。
ツール結果にない列車や情報を推測しないでください。
過去の混雑やピークについて聞かれた場合はquery_daily_congestion_peakを使い、
日付指定がなければ利用者メッセージに含まれる日本時間の今日の日付を使ってください。
ツールが返した観測件数、時刻、合計値を根拠として答えてください。
晴れ・雨・雪の変更はset_weather、通常・模型モードの変更はset_scene_modeを
使ってください。混雑の棒グラフや目的地へのアーチの表示・非表示は
set_layer_visibilityを使ってください。
画面操作が完了したら、実行した内容を自然な文章で伝えてください。
"""

TOOLS = [
    {
        "toolSpec": {
            "name": "set_display_time",
            "description": "計画ダイヤの表示時刻を変更します。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "routeTimeMinutes": {
                            "type": "number",
                            "description": "0時からの分数。25時は1500。",
                        }
                    },
                    "required": ["routeTimeMinutes"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "search_trains",
            "description": (
                "現在の表示時刻に運行中の列車を、駅名、種別、列車名、"
                "列車番号を含む日本語の条件で検索します。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "利用者の検索条件を保った短い日本語。",
                        },
                        "limit": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 5,
                        },
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "query_daily_congestion_peak",
            "description": (
                "指定した日本時間の日付について、1分ごとの保存済み混雑サマリーから"
                "全列車の合計混雑値が最大だった観測を検索します。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "serviceDate": {
                            "type": "string",
                            "description": "日本時間の日付（YYYY-MM-DD）。",
                        }
                    },
                    "required": ["serviceDate"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "focus_train",
            "description": "検索結果に含まれる列車を選択し、カメラを移動します。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "serviceUid": {
                            "type": "string",
                            "description": "search_trainsが返したserviceUid。",
                        }
                    },
                    "required": ["serviceUid"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "set_weather",
            "description": "地図の天気表現を晴れ、雨、雪から選びます。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "weather": {
                            "type": "string",
                            "enum": ["clear", "rain", "snow"],
                        }
                    },
                    "required": ["weather"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "set_scene_mode",
            "description": "地図を通常表示または模型モードへ変更します。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "sceneMode": {
                            "type": "string",
                            "enum": ["normal", "model"],
                        }
                    },
                    "required": ["sceneMode"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "set_layer_visibility",
            "description": "混雑の棒グラフまたは目的地アーチを表示・非表示にします。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "layer": {
                            "type": "string",
                            "enum": ["congestion", "destination_arcs"],
                        },
                        "visible": {"type": "boolean"},
                    },
                    "required": ["layer", "visible"],
                }
            },
        }
    },
]


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
    value = request_value(event)
    return validated_messages(value)


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
    if (
        not isinstance(messages, list)
        or not messages
        or len(messages) > MAX_MESSAGES
    ):
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
    blocks = [_validated_content_block(block, role) for block in content]
    return {"role": role, "content": blocks}


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
            and tool_use.get("name") in {tool["toolSpec"]["name"] for tool in TOOLS}
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
        return len(json.dumps(block["json"], ensure_ascii=False)) <= 8_000
    except (TypeError, ValueError):
        return False


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


def query_daily_congestion_peak(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    if not DATE_PATTERN.fullmatch(service_date):
        raise RequestError(400, "serviceDateはYYYY-MM-DD形式にしてください。")
    try:
        parsed_date = datetime.strptime(service_date, "%Y-%m-%d")
    except ValueError as error:
        raise RequestError(400, "serviceDateが実在する日付ではありません。") from error
    if parsed_date.strftime("%Y-%m-%d") != service_date:
        raise RequestError(400, "serviceDateが不正です。")

    items: list[dict[str, Any]] = []
    exclusive_start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "TableName": summary_table,
            "KeyConditionExpression": "serviceDate = :service_date",
            "ExpressionAttributeValues": {":service_date": {"S": service_date}},
        }
        if exclusive_start_key:
            request["ExclusiveStartKey"] = exclusive_start_key
        result = dynamodb_client.query(**request)
        items.extend(result.get("Items", []))
        exclusive_start_key = result.get("LastEvaluatedKey")
        if not exclusive_start_key:
            break

    if not items:
        return {
            "serviceDate": service_date,
            "sampleCount": 0,
            "peak": None,
        }

    peak = max(
        items,
        key=lambda item: (
            dynamo_number(item.get("totalCongestion")),
            item.get("collectedAt", {}).get("S", ""),
        ),
    )
    train_totals = peak.get("trainTotals", {}).get("M", {})
    top_trains = sorted(
        (
            {
                "trainNumber": train_number,
                "totalCongestion": number_for_response(dynamo_number(value)),
            }
            for train_number, value in train_totals.items()
        ),
        key=lambda item: (-item["totalCongestion"], item["trainNumber"]),
    )[:5]
    return {
        "serviceDate": service_date,
        "sampleCount": len(items),
        "peak": {
            "collectedAt": peak["collectedAt"]["S"],
            "sourceUpdatedAt": peak["sourceUpdatedAt"]["S"],
            "totalCongestion": number_for_response(
                dynamo_number(peak["totalCongestion"])
            ),
            "trainCount": int(dynamo_number(peak["trainCount"])),
            "carCount": int(dynamo_number(peak["carCount"])),
            "topTrains": top_trains,
        },
    }


def dynamo_number(value: Any) -> Decimal:
    if not isinstance(value, dict) or not isinstance(value.get("N"), str):
        return Decimal(0)
    return Decimal(value["N"])


def number_for_response(value: Decimal) -> int | float:
    integral = value.to_integral_value()
    return int(integral) if value == integral else float(value)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        value = request_value(event)
        if value.get("operation") == "daily_congestion_peak":
            service_date = value.get("serviceDate")
            if not isinstance(service_date, str):
                raise RequestError(400, "serviceDateが必要です。")
            import boto3

            result = query_daily_congestion_peak(
                boto3.client("dynamodb"),
                SUMMARY_TABLE,
                service_date,
            )
            return response(200, result)
        messages = validated_messages(value)
    except RequestError as error:
        return response(error.status_code, {"message": str(error)})

    import boto3

    result = converse(boto3.client("bedrock-runtime"), messages)
    return response(200, result)


class RequestError(ValueError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
