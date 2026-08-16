from __future__ import annotations

from typing import Any

from request_contract import ALLOWED_TOOL_NAMES


SYSTEM_PROMPT = """\
あなたはTransitForgeのAI駅員です。日本語で簡潔に案内してください。
利用者が列車を探したい場合はsearch_trainsを使い、その結果のserviceUidだけを
focus_trainへ渡してください。時刻の変更はset_display_timeを使ってください。
時刻変更と列車検索が同じ依頼に含まれる場合は、時刻を変更して結果を受け取ってから
列車を検索してください。時刻変更だけの依頼ではsearch_trainsを呼ばないでください。
指定時刻ごろに駅へ着く列車を尋ねられた場合はsearch_train_arrivalsを使ってください。
この時刻は検索条件であり、画面の時刻変更も明示されない限りset_display_timeを
呼ばないでください。到着検索は指定時刻の前後30分を対象にします。
出発駅から行き先までの経路を尋ねられた場合はsearch_direct_routesを
使ってください。出発駅が指定されていない場合はoriginStationを省略し、ブラウザが
現在地から出発可能な最寄り駅を選べるようにしてください。現在地の座標はAIには
送られません。出発時刻が指定されていない場合は、利用者メッセージに含まれる
現在の表示時刻をそのまま使い、別の時刻を推測しないでください。
利用者が出発日を指定した場合は実日付をYYYY-MM-DDにしてdepartureDateへ渡してください。
平日か土休日かは推測せず、日付だけを渡してください。
直通と乗換3回までの候補を比較し、乗換候補では乗換駅と待ち時間を案内してください。
候補が見つかったら、表示時刻を変更せずに先頭候補の最初のserviceUidを
focus_trainへ渡してください。
候補がまだ運行開始前でフォーカスできない場合も、発着時刻をそのまま案内してください。
経路検索のためにset_display_timeを呼ばないでください。画面の再生は継続します。
検索結果は最大3件だけ案内し、ツール結果にない乗換経路を推測しないでください。
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
宿泊先を探す依頼では、行き先とチェックイン・チェックアウト日が明示されている場合だけ
search_accommodationsを使ってください。空室や日付別の料金はこの検索結果から推測しないでください。
晴れ・曇り・雨・雪の変更はset_weatherを使ってください。
混雑の棒グラフや目的地へのアーチの表示・非表示は
set_layer_visibilityを使ってください。
利用者が求めていない現在の表示時刻や今日の日付は回答で繰り返さないでください。
画面操作が完了したら、実行した内容を自然な文章で伝えてください。
"""

TOOLS = [
    {
        "toolSpec": {
            "name": "search_accommodations",
            "description": "指定した行き先と宿泊日程に合う宿泊施設候補を最大5件検索します。料金と空室は含まれない場合があります。",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "destination": {"type": "string"},
                        "checkInDate": {"type": "string", "description": "YYYY-MM-DD"},
                        "checkOutDate": {"type": "string", "description": "YYYY-MM-DD"},
                        "adults": {"type": "integer", "minimum": 1, "maximum": 10},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 5},
                    },
                    "required": ["destination", "checkInDate", "checkOutDate"],
                }
            },
        }
    },
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
                "出発駅から行き先まで、指定時刻以降に直通または乗換3回までで行ける経路を"
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
                        "departureDate": {
                            "type": "string",
                            "description": (
                                "利用者が指定した実日付（YYYY-MM-DD）。"
                                "日付指定がなければ省略する。"
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
            "description": "列車検索または経路検索の結果に含まれる列車を選択し、カメラを移動します。",
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
