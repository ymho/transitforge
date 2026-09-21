# ADR 0072: 実会話比較後も現行Agent model routingを維持する

- ステータス: Accepted
- 日付: 2026-09-21
- 関連: #474、ADR 0047 / 0048、PR #524 / #525

## 決定

Agentのproduction routingは変更せず、defaultを`amazon.nova-lite-v1:0`、decisionを
`jp.amazon.nova-2-lite-v1:0`のまま維持する。比較候補の
`global.anthropic.claude-sonnet-4-6`は現時点では採用しない。

これは候補モデルが常に劣るという決定ではない。実Feedback由来の3会話を各3回実行した結果、
候補はTool選択、条件遵守、Groundingを改善した一方、全3ケースが要求した行程・概算・写真付き提案を
完遂できず、latency、token、Tool callも増加した。全評価ケースを完遂しない候補は、相対指標だけが
改善してもproduction routingへ推薦しない。

## 比較結果

GitHub Actions run `35580805305`を2026-09-21に実行した。baselineとcandidateは同じ
dataset v4、3ケース、各3反復、合成Provider結果、Server Agent Runtimeを使用した。

| 指標 | 現行routing | Sonnet 4.6 decision | 変化 |
| --- | ---: | ---: | ---: |
| 合格ケース | 0/3 | 0/3 | 変化なし |
| Tool選択 | 0.000 | 0.667 | 改善 |
| 条件遵守 | 0.817 | 0.901 | 改善 |
| Grounded Claim | 0.167 | 0.333 | 改善 |
| Unsupported Claim | 0.833 | 0.667 | 改善 |
| Task completion | 0.496 | 0.467 | 低下 |
| model latency合計 | 78,138 ms | 165,444 ms | +111.7% |
| 入出力token合計 | 255,178 | 353,744 | +38.6% |
| model call | 34 | 36 | +5.9% |
| Tool call | 9 | 32 | +255.6% |

初回run `35578657347`は合成ToolがEvidenceを返さず、正常なEvidence選択も
`invalid_used_evidence_ids`として拒否していたため、モデル判断には使わない。PR #525で本番と同じ
ExternalTravelInformation / Evidence mapperへ修正した。修正後runではこのエラーとcandidateの
`runtime_limit_reached`は0件だった。

## 観測した共通ボトルネック

両routingとも、Tool後の一般旅行回答がApplicationのEvidence presenterによって出典付き抜粋へ置換され、
モデルが判断した日別行程、費用前提、候補比較を利用者へ届けられていない。Sonnetは必要なToolを多く選んだが、
最終表示は出雲大社または宿のEvidence列挙に留まった。したがってモデルだけを上げても、今回期待した
「質問票に戻らず、写真付きの簡単な旅程を一度に返す」品質には到達しない。

写真fixtureは本番の`image.url`を返していたが、初回の採点器は`photoUrl` / `imageUrl`だけを数えていた。
これは採点器の過小評価であり、本番形式を数えるよう修正する。Web検索だけで写真検索・地点照合へ進まない
目的地未定ケースは、修正後も写真完遂とは扱わない。

## 影響と再検討条件

現行routingを維持するためTerraform、IAM、production model IDは変更しない。Sonnetの追加latencyとtoken、
Tool過多をproductionへ持ち込まない。これは一般回答の構成改善を不要にする判断ではない。

一般planning回答で、検証済み事実を固定描画しながらモデルの非事実部分（仮定を明記した行程、比較、概算）を
安全に合成できる契約を実装し、同じ3ケースが安定して完遂できる状態になった後に再比較する。
再比較では本番形式の写真集計、全ケース合格gate、同一反復数を維持する。
