from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import representative_timetable

MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")
SUMMARY_TABLE = os.environ.get("SUMMARY_TABLE", "")
DELAY_SUMMARY_TABLE = os.environ.get("DELAY_SUMMARY_TABLE", "")
AI_TIMETABLE_BUCKET = os.environ.get("AI_TIMETABLE_BUCKET", "")
AI_TIMETABLE_PREFIX = os.environ.get("AI_TIMETABLE_PREFIX", "ai-timetable")
MAX_BODY_BYTES = 32 * 1024
MAX_MESSAGES = 16
MAX_CONTENT_BLOCKS = 12
MAX_TEXT_CHARACTERS = 4_000
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
JST = timezone(timedelta(hours=9))

SYSTEM_PROMPT = """\
あなたはTransitForgeのAI駅員です。日本語で簡潔に案内してください。
利用者が列車を探したい場合はsearch_trainsを使い、その結果のserviceUidだけを
focus_trainへ渡してください。時刻の変更はset_display_timeを使ってください。
時刻変更と列車検索が同じ依頼に含まれる場合は、時刻を変更して結果を受け取ってから
列車を検索してください。時刻変更だけの依頼ではsearch_trainsを呼ばないでください。
指定時刻ごろに駅へ着く列車を尋ねられた場合はsearch_train_arrivalsを使ってください。
この時刻は検索条件であり、画面の時刻変更も明示されない限りset_display_timeを
呼ばないでください。到着検索は指定時刻の前後30分を対象にします。
出発駅から行き先まで乗り換えなしの経路を尋ねられた場合はsearch_direct_routesを
使ってください。出発駅が指定されていない場合はoriginStationを省略し、ブラウザが
現在地から直通可能な最寄り駅を選べるようにしてください。現在地の座標はAIには
送られません。出発時刻が指定されていない場合は現在の表示時刻を使ってください。
候補が見つかったら先頭候補の発車時刻をset_display_timeへ渡し、その結果を受け取ってから
候補のserviceUidをfocus_trainへ渡してください。検索結果は最大3件だけ案内し、
乗り換え経路を推測しないでください。
平日または土日祝の代表的なダイヤについて尋ねられた場合は
search_representative_timetableを使ってください。この検索結果は代表日の計画ダイヤであり、
現在の列車位置や運行実績ではありません。
ツール結果にない列車や情報を推測しないでください。
過去の混雑、ピーク、時間別推移、混雑した路線・列車について聞かれた場合は
query_daily_congestion_analysisを使い、
日付指定がなければ利用者メッセージに含まれる日本時間の今日の日付を使ってください。
ツールが返した観測期間、観測件数、時間別平均、ピーク、路線・列車順位を根拠として
答えてください。未観測の時間帯を混雑ゼロとして扱わないでください。
列車順位を説明するときは、列車番号だけでなく、取得できた種別、列車名、行き先も
含めてください。路線順位は行き先側の路線による分類であることを必要に応じて伝えてください。
現在または過去の列車の遅れ、時間別の遅延傾向について聞かれた場合は
query_train_delay_analysisを使ってください。現在の遅れはlatest、1日の傾向はhourlyと
topTrainsを根拠にし、観測されていない時間や列車を遅れなしと断定しないでください。
晴れ・曇り・雨・雪の変更はset_weatherを使ってください。
混雑の棒グラフや目的地へのアーチの表示・非表示は
set_layer_visibilityを使ってください。
利用者が求めていない現在の表示時刻や今日の日付は回答で繰り返さないでください。
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
            "name": "query_daily_congestion_analysis",
            "description": (
                "指定した日本時間の日付について、1分ごとの保存済み混雑サマリーから、"
                "日次ピーク、1時間ごとの推移、混雑した路線と列車を分析します。"
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
            "name": "search_direct_routes",
            "description": (
                "出発駅から行き先まで、指定時刻以降に乗り換えなしで行ける列車を"
                "最大3件検索します。出発駅の省略時はブラウザが現在地から最寄り駅を選びます。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "originStation": {
                            "type": "string",
                            "description": "出発駅。利用者が指定しなければ省略する。",
                        },
                        "destinationStation": {
                            "type": "string",
                            "description": "行き先の駅名。",
                        },
                        "departureTimeMinutes": {
                            "type": "number",
                            "description": "出発希望時刻を0時からの分数で指定。",
                        },
                    },
                    "required": ["destinationStation", "departureTimeMinutes"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "search_train_arrivals",
            "description": (
                "指定時刻の前後30分に、指定駅へ到着する列車を種別などで検索します。"
                "画面の表示時刻は変更しません。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "駅名と列車種別を含む利用者の検索条件。",
                        },
                        "targetTimeMinutes": {
                            "type": "number",
                            "description": "検索中心時刻を0時からの分数で指定。",
                        },
                        "limit": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 5,
                        },
                    },
                    "required": ["query", "targetTimeMinutes"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "search_representative_timetable",
            "description": (
                "非公開S3に保持した平日または土日祝の代表ダイヤから、"
                "列車、到着、出発を検索します。現在の運行状況ではありません。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "timetableKind": {
                            "type": "string",
                            "enum": ["weekday", "weekend_holiday"],
                        },
                        "query": {"type": "string"},
                        "mode": {
                            "type": "string",
                            "enum": ["active", "arrivals", "departures"],
                        },
                        "targetTimeMinutes": {
                            "type": "number",
                            "description": "0時からの分数。25時は1500。省略時は時刻で絞りません。",
                        },
                        "limit": {"type": "integer", "minimum": 1, "maximum": 5},
                    },
                    "required": ["timetableKind", "query", "mode"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "query_train_delay_analysis",
            "description": (
                "指定した日本時間の日付について、保存済みの毎分列車遅延から、"
                "最新状況、日次ピーク、1時間ごとの傾向、遅れた列車を分析します。"
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
            "description": "列車検索または直通経路検索の結果に含まれる列車を選択し、カメラを移動します。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "serviceUid": {
                            "type": "string",
                            "description": "列車検索ツールが返したserviceUid。",
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
            "description": "地図の天気表現を晴れ、曇り、雨、雪から選びます。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "weather": {
                            "type": "string",
                            "enum": ["clear", "cloudy", "rain", "snow"],
                        }
                    },
                    "required": ["weather"],
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
        return (
            len(
                json.dumps(
                    block["json"],
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
            <= 8_000
        )
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


def query_daily_congestion_analysis(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    validate_service_date(service_date)
    items = query_daily_summary_items(
        dynamodb_client,
        summary_table,
        service_date,
    )
    samples = sorted(
        (
            sample
            for item in items
            if (sample := congestion_sample(item)) is not None
        ),
        key=lambda sample: sample["collectedAt"],
    )
    if not samples:
        return {
            "serviceDate": service_date,
            "sampleCount": 0,
            "observationStart": None,
            "observationEnd": None,
            "peak": None,
            "hourly": empty_hourly_analysis(),
            "trainStats": [],
        }

    peak = max(
        samples,
        key=lambda sample: (sample["totalCongestion"], sample["collectedAt"]),
    )
    return {
        "serviceDate": service_date,
        "sampleCount": len(samples),
        "observationStart": samples[0]["collectedAt"],
        "observationEnd": samples[-1]["collectedAt"],
        "peak": peak_response(peak),
        "hourly": hourly_analysis(samples),
        "trainStats": daily_train_stats(samples),
    }


def validate_service_date(service_date: str) -> None:
    if not DATE_PATTERN.fullmatch(service_date):
        raise RequestError(400, "serviceDateはYYYY-MM-DD形式にしてください。")
    try:
        parsed_date = datetime.strptime(service_date, "%Y-%m-%d")
    except ValueError as error:
        raise RequestError(400, "serviceDateが実在する日付ではありません。") from error
    if parsed_date.strftime("%Y-%m-%d") != service_date:
        raise RequestError(400, "serviceDateが不正です。")


def query_daily_summary_items(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> list[dict[str, Any]]:
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

    return items


def congestion_sample(item: dict[str, Any]) -> dict[str, Any] | None:
    collected_at = dynamo_string(item.get("collectedAt"))
    source_updated_at = dynamo_string(item.get("sourceUpdatedAt"))
    if collected_at is None or source_updated_at is None:
        return None
    try:
        parsed_collected_at = datetime.fromisoformat(collected_at)
    except ValueError:
        return None
    if parsed_collected_at.tzinfo is None:
        return None
    return {
        "collectedAt": collected_at,
        "sourceUpdatedAt": source_updated_at,
        "hourJst": parsed_collected_at.astimezone(JST).hour,
        "totalCongestion": dynamo_number(item.get("totalCongestion")),
        "trainCount": dynamo_number(item.get("trainCount")),
        "carCount": dynamo_number(item.get("carCount")),
        "trainTotals": dynamo_number_map(item.get("trainTotals")),
    }


def peak_response(peak: dict[str, Any]) -> dict[str, Any]:
    top_trains = sorted(
        (
            {
                "trainNumber": train_number,
                "totalCongestion": number_for_response(total),
            }
            for train_number, total in peak["trainTotals"].items()
        ),
        key=lambda item: (-item["totalCongestion"], item["trainNumber"]),
    )[:5]
    return {
        "collectedAt": peak["collectedAt"],
        "sourceUpdatedAt": peak["sourceUpdatedAt"],
        "totalCongestion": number_for_response(peak["totalCongestion"]),
        "trainCount": int(peak["trainCount"]),
        "carCount": int(peak["carCount"]),
        "topTrains": top_trains,
    }


def empty_hourly_analysis() -> list[dict[str, Any]]:
    return [hourly_response(hour, []) for hour in range(24)]


def hourly_analysis(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples_by_hour: list[list[dict[str, Any]]] = [[] for _ in range(24)]
    for sample in samples:
        samples_by_hour[sample["hourJst"]].append(sample)
    return [
        hourly_response(hour, hour_samples)
        for hour, hour_samples in enumerate(samples_by_hour)
    ]


def hourly_response(
    hour: int,
    samples: list[dict[str, Any]],
) -> dict[str, Any]:
    if not samples:
        return {
            "hourJst": hour,
            "sampleCount": 0,
            "averageTotalCongestion": None,
            "peakTotalCongestion": None,
            "peakCollectedAt": None,
            "averageTrainCount": None,
            "topTrain": None,
        }

    peak = max(
        samples,
        key=lambda sample: (sample["totalCongestion"], sample["collectedAt"]),
    )
    train_stats = aggregate_train_stats(samples)
    top_train = (
        max(
            train_stats.items(),
            key=lambda item: (
                item[1]["sum"] / item[1]["observedSampleCount"],
                item[1]["peak"],
                item[0],
            ),
        )
        if train_stats
        else None
    )
    return {
        "hourJst": hour,
        "sampleCount": len(samples),
        "averageTotalCongestion": average_for_response(
            sum((sample["totalCongestion"] for sample in samples), Decimal(0)),
            len(samples),
        ),
        "peakTotalCongestion": number_for_response(peak["totalCongestion"]),
        "peakCollectedAt": peak["collectedAt"],
        "averageTrainCount": average_for_response(
            sum((sample["trainCount"] for sample in samples), Decimal(0)),
            len(samples),
        ),
        "topTrain": (
            train_stat_response(top_train[0], top_train[1], len(samples))
            if top_train
            else None
        ),
    }


def daily_train_stats(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stats = aggregate_train_stats(samples)
    return sorted(
        (
            train_stat_response(train_number, stat, len(samples))
            for train_number, stat in stats.items()
        ),
        key=lambda item: (
            -item["peakCongestion"],
            -item["averageCongestion"],
            item["trainNumber"],
        ),
    )


def aggregate_train_stats(
    samples: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    for sample in samples:
        for train_number, congestion in sample["trainTotals"].items():
            stat = stats.setdefault(
                train_number,
                {
                    "sum": Decimal(0),
                    "observedSampleCount": 0,
                    "peak": Decimal(-1),
                    "peakCollectedAt": sample["collectedAt"],
                },
            )
            stat["sum"] += congestion
            stat["observedSampleCount"] += 1
            if congestion >= stat["peak"]:
                stat["peak"] = congestion
                stat["peakCollectedAt"] = sample["collectedAt"]
    return stats


def train_stat_response(
    train_number: str,
    stat: dict[str, Any],
    total_sample_count: int,
) -> dict[str, Any]:
    return {
        "trainNumber": train_number,
        "observedSampleCount": stat["observedSampleCount"],
        "averageCongestion": average_for_response(
            stat["sum"], stat["observedSampleCount"]
        ),
        "dailyAverageContribution": average_for_response(
            stat["sum"], total_sample_count
        ),
        "peakCongestion": number_for_response(stat["peak"]),
        "peakCollectedAt": stat["peakCollectedAt"],
    }


def query_daily_congestion_peak(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    analysis = query_daily_congestion_analysis(
        dynamodb_client,
        summary_table,
        service_date,
    )
    return {
        "serviceDate": analysis["serviceDate"],
        "sampleCount": analysis["sampleCount"],
        "peak": analysis["peak"],
    }


def query_train_delay_analysis(
    dynamodb_client: Any,
    summary_table: str,
    service_date: str,
) -> dict[str, Any]:
    validate_service_date(service_date)
    samples = sorted(
        (
            sample
            for item in query_daily_summary_items(
                dynamodb_client, summary_table, service_date
            )
            if (sample := delay_sample(item)) is not None
        ),
        key=lambda sample: sample["collectedAt"],
    )
    if not samples:
        return {
            "serviceDate": service_date,
            "sampleCount": 0,
            "observationStart": None,
            "observationEnd": None,
            "latest": None,
            "peak": None,
            "hourly": [empty_delay_hour(hour) for hour in range(24)],
            "trainStats": [],
        }

    peak = max(
        samples,
        key=lambda sample: (
            sample["delayedTrainCount"],
            sample["totalDelayMinutes"],
            sample["collectedAt"],
        ),
    )
    return {
        "serviceDate": service_date,
        "sampleCount": len(samples),
        "observationStart": samples[0]["collectedAt"],
        "observationEnd": samples[-1]["collectedAt"],
        "latest": delay_snapshot_response(samples[-1]),
        "peak": delay_snapshot_response(peak),
        "hourly": delay_hourly_analysis(samples),
        "trainStats": daily_delay_train_stats(samples),
    }


def delay_sample(item: dict[str, Any]) -> dict[str, Any] | None:
    collected_at = dynamo_string(item.get("collectedAt"))
    if collected_at is None:
        return None
    try:
        parsed_collected_at = datetime.fromisoformat(collected_at)
    except ValueError:
        return None
    if parsed_collected_at.tzinfo is None:
        return None
    return {
        "collectedAt": collected_at,
        "hourJst": parsed_collected_at.astimezone(JST).hour,
        "sourceCount": dynamo_number(item.get("sourceCount")),
        "failureCount": dynamo_number(item.get("failureCount")),
        "observedTrainCount": dynamo_number(item.get("observedTrainCount")),
        "delayedTrainCount": dynamo_number(item.get("delayedTrainCount")),
        "totalDelayMinutes": dynamo_number(item.get("totalDelayMinutes")),
        "maximumDelayMinutes": dynamo_number(item.get("maximumDelayMinutes")),
        "trainDelays": dynamo_number_map(item.get("trainDelays")),
    }


def delay_snapshot_response(sample: dict[str, Any]) -> dict[str, Any]:
    top_trains = sorted(
        (
            {
                "trainNumber": train_number,
                "delayMinutes": number_for_response(delay),
            }
            for train_number, delay in sample["trainDelays"].items()
        ),
        key=lambda train: (-train["delayMinutes"], train["trainNumber"]),
    )[:10]
    return {
        "collectedAt": sample["collectedAt"],
        "sourceCount": int(sample["sourceCount"]),
        "failureCount": int(sample["failureCount"]),
        "observedTrainCount": int(sample["observedTrainCount"]),
        "delayedTrainCount": int(sample["delayedTrainCount"]),
        "totalDelayMinutes": number_for_response(sample["totalDelayMinutes"]),
        "maximumDelayMinutes": number_for_response(sample["maximumDelayMinutes"]),
        "topTrains": top_trains,
    }


def empty_delay_hour(hour: int) -> dict[str, Any]:
    return {
        "hourJst": hour,
        "sampleCount": 0,
        "averageDelayedTrainCount": None,
        "peakDelayedTrainCount": None,
        "peakTotalDelayMinutes": None,
        "maximumDelayMinutes": None,
        "peakCollectedAt": None,
    }


def delay_hourly_analysis(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples_by_hour: list[list[dict[str, Any]]] = [[] for _ in range(24)]
    for sample in samples:
        samples_by_hour[sample["hourJst"]].append(sample)

    result: list[dict[str, Any]] = []
    for hour, hour_samples in enumerate(samples_by_hour):
        if not hour_samples:
            result.append(empty_delay_hour(hour))
            continue
        peak = max(
            hour_samples,
            key=lambda sample: (
                sample["delayedTrainCount"],
                sample["totalDelayMinutes"],
                sample["collectedAt"],
            ),
        )
        result.append(
            {
                "hourJst": hour,
                "sampleCount": len(hour_samples),
                "averageDelayedTrainCount": average_for_response(
                    sum(
                        (sample["delayedTrainCount"] for sample in hour_samples),
                        Decimal(0),
                    ),
                    len(hour_samples),
                ),
                "peakDelayedTrainCount": int(peak["delayedTrainCount"]),
                "peakTotalDelayMinutes": number_for_response(
                    peak["totalDelayMinutes"]
                ),
                "maximumDelayMinutes": number_for_response(
                    max(sample["maximumDelayMinutes"] for sample in hour_samples)
                ),
                "peakCollectedAt": peak["collectedAt"],
            }
        )
    return result


def daily_delay_train_stats(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    for sample in samples:
        for train_number, delay in sample["trainDelays"].items():
            stat = stats.setdefault(
                train_number,
                {
                    "sum": Decimal(0),
                    "delayedSampleCount": 0,
                    "peak": Decimal(-1),
                    "peakCollectedAt": sample["collectedAt"],
                },
            )
            stat["sum"] += delay
            stat["delayedSampleCount"] += 1
            if delay >= stat["peak"]:
                stat["peak"] = delay
                stat["peakCollectedAt"] = sample["collectedAt"]

    return sorted(
        (
            {
                "trainNumber": train_number,
                "delayedSampleCount": stat["delayedSampleCount"],
                "averageDelayWhenDelayed": average_for_response(
                    stat["sum"], stat["delayedSampleCount"]
                ),
                "dailyAverageDelayContribution": average_for_response(
                    stat["sum"], len(samples)
                ),
                "peakDelayMinutes": number_for_response(stat["peak"]),
                "peakCollectedAt": stat["peakCollectedAt"],
            }
            for train_number, stat in stats.items()
        ),
        key=lambda train: (
            -train["peakDelayMinutes"],
            -train["delayedSampleCount"],
            train["trainNumber"],
        ),
    )


def dynamo_number(value: Any) -> Decimal:
    if not isinstance(value, dict) or not isinstance(value.get("N"), str):
        return Decimal(0)
    return Decimal(value["N"])


def dynamo_string(value: Any) -> str | None:
    if not isinstance(value, dict) or not isinstance(value.get("S"), str):
        return None
    return value["S"]


def dynamo_number_map(value: Any) -> dict[str, Decimal]:
    if not isinstance(value, dict) or not isinstance(value.get("M"), dict):
        return {}
    return {
        key: dynamo_number(raw_value)
        for key, raw_value in value["M"].items()
        if isinstance(key, str)
    }


def number_for_response(value: Decimal) -> int | float:
    integral = value.to_integral_value()
    return int(integral) if value == integral else float(value)


def average_for_response(total: Decimal, count: int) -> int | float:
    if count <= 0:
        return 0
    return number_for_response((total / Decimal(count)).quantize(Decimal("0.01")))


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        value = request_value(event)
        if value.get("operation") == "representative_timetable_search":
            import boto3

            try:
                result = representative_timetable.search(
                    boto3.client("s3"), AI_TIMETABLE_BUCKET, AI_TIMETABLE_PREFIX, value
                )
            except representative_timetable.TimetableSearchError as error:
                raise RequestError(400, str(error)) from error
            return response(200, result)
        if value.get("operation") in {
            "daily_congestion_analysis",
            "daily_congestion_peak",
            "train_delay_analysis",
        }:
            service_date = value.get("serviceDate")
            if not isinstance(service_date, str):
                raise RequestError(400, "serviceDateが必要です。")
            import boto3

            operation = value.get("operation")
            if operation == "train_delay_analysis":
                query = query_train_delay_analysis
                table = DELAY_SUMMARY_TABLE
            elif operation == "daily_congestion_analysis":
                query = query_daily_congestion_analysis
                table = SUMMARY_TABLE
            else:
                query = query_daily_congestion_peak
                table = SUMMARY_TABLE
            result = query(boto3.client("dynamodb"), table, service_date)
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
