from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import representative_timetable
from dynamodb_analysis import (
    average_for_response,
    dynamo_number,
    dynamo_number_map,
    dynamo_string,
    number_for_response,
    query_operating_day_summary_items,
    validate_service_date,
)
from request_contract import (
    ALLOWED_TOOL_NAMES,
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
送られません。出発時刻が指定されていない場合は、利用者メッセージに含まれる
現在の表示時刻をそのまま使い、別の時刻を推測しないでください。
候補が見つかったら、表示時刻を変更せずに候補のserviceUidをfocus_trainへ渡してください。
候補がまだ運行開始前でフォーカスできない場合も、発着時刻をそのまま案内してください。
経路検索のためにset_display_timeを呼ばないでください。画面の再生は継続します。
検索結果は最大3件だけ案内し、
乗り換え経路を推測しないでください。
平日または土日祝の代表的なダイヤについて尋ねられた場合は
search_representative_timetableを使ってください。この検索結果は代表日の計画ダイヤであり、
現在の列車位置や運行実績ではありません。
ツール結果にない列車や情報を推測しないでください。
過去の混雑、ピーク、時間別推移、混雑した路線・列車について聞かれた場合は
query_daily_congestion_analysisを使い、
日付指定がなければ利用者メッセージに含まれる4時切替の業務日付を使ってください。
ツールが返した観測期間、観測件数、時間別平均、ピーク、路線・列車順位を根拠として
答えてください。未観測の時間帯を混雑ゼロとして扱わないでください。
列車順位を説明するときは、列車番号だけでなく、取得できた種別、列車名、行き先も
含めてください。路線順位は行き先側の路線による分類であることを必要に応じて伝えてください。
現在または過去の列車の遅れ、時間別の遅延傾向について聞かれた場合は
query_train_delay_analysisを使ってください。現在の遅れはlatest、1日の傾向はhourlyと
topTrainsを根拠にし、観測されていない時間や列車を遅れなしと断定しないでください。
日付指定がなければ利用者メッセージに含まれる4時切替の業務日付を使ってください。
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
                "指定した4時切替の業務日付について、1分ごとの保存済み混雑サマリーから、"
                "日次ピーク、1時間ごとの推移、混雑した路線と列車を分析します。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "serviceDate": {
                            "type": "string",
                            "description": "4時切替の業務日付（YYYY-MM-DD）。",
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
                            "description": (
                                "出発希望時刻を0時からの分数で指定。利用者が時刻を"
                                "指定していなければ、利用者メッセージ中の現在の表示時刻を使う。"
                            ),
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
                "指定した4時切替の業務日付について、保存済みの毎分列車遅延から、"
                "最新状況、日次ピーク、1時間ごとの傾向、遅れた列車を分析します。"
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "serviceDate": {
                            "type": "string",
                            "description": "4時切替の業務日付（YYYY-MM-DD）。",
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

if {tool["toolSpec"]["name"] for tool in TOOLS} != ALLOWED_TOOL_NAMES:
    raise RuntimeError("Bedrock tool definitions and request validation are out of sync")


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
    items = query_operating_day_summary_items(
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
            for item in query_operating_day_summary_items(
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
