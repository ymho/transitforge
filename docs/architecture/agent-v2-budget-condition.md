# Agent v2の今回予算条件

関連: #716 / #724 / #728 / #730 / #732。V2基準モデルはADR 0098のNova 2 Lite。

## 境界

予算は今回の旅行条件であり、Profileの恒久的な予算感から補完しない。モデルへ公開する永続変更操作は`update_current_budget`の1つだけ。

- `action=set`: 今回の予算を設定・訂正する。
- `action=clear`: 今回の予算を明示撤回する。

what-ifは既存の非永続`consider_trip_scenario`へ追加し、budget専用scenario Toolは作らない。

## Model inputとApplication authority

モデル入力はamount、任意currency、任意basis、外側quoteだけ。

- amountは通貨のmajor unit。5万円は50000、500ユーロは500。
- currencyはJPY/EUR/CHF/USD/GBP/KWDのうち、利用者が通貨を明示した場合だけ候補として渡す。
- basisは`trip`または`per_person`のうち、利用者が旅行全体/1人あたりを明示した場合だけ候補として渡す。

Applicationはモデル値をそのまま権威にしない。

- quoteは現在のuserMessageの完全な部分文字列でなければならない。
- amountはquote内の金額表現と一致する必要がある。万/千は決定論的にmajor unitへ展開する。
- 円/ユーロ等がquoteに無ければモデルがcurrencyを付けても保存しない。
- 「全部で/総額/合計/全体で」等が無ければtrip basisを保存しない。
- 「1人あたり」または金額に結び付いた「1人5万円」等が無ければper_personを保存しない。
- currency/basisが不明でもamount自体がgroundedならConversation条件として保持できる。
- 「くらい/程度/ほど/前後/目安」はoperation precisionをapproximateとし、それ以外はexactとする。

## Downstream projection

Conversationの`IntentValue.money`はcurrency/basisを任意で保持できる。しかしTripのbudget requirementは金額・通貨・basisが揃って初めて比較可能である。

したがって`proposeVerifiedIntentRequest`は、

- supported currencyがある
- basisが`trip`または`per_person`として確認済み

の場合だけTrip budget constraintへ投影する。basis未確認を従来のように暗黙のtripへ変換しない。

## Journal / replay

business slotは`budget`。既存condition journal/CASをそのまま使う。

- mutationId: `condition:<turnId>:budget`
- same turn + same final budget: receipt replay
- same turn + different budget: conflict
- later turn: correctionとして新しいslot
- clear: budget targetだけretract
- SDK toolUseId/model cycle/call orderは冪等キーにしない

## Scenario

`consider_trip_scenario(kind=budget)`は予算what-ifを非永続で扱う。Application側でamount/currency/basisを同じgrounding規則へ通すが、A commit、Intent revision、Profile、Tripは変更しない。

## V1からの分離

V1 semantic interpreter、旧semantic corpus、V1 runtime testsをoracleにしない。V2の公開Zod Tool契約、Application grounding、pure reducer、CAS/replay、Effective Intent、downstream projectionを受入基準とする。

## 検証

決定論的テストでは以下を確認する。

- 「全部で10万円」→ amount=100000 / JPY / trip
- 「1人5万円くらい」→ amount=50000 / JPY / per_person / approximate
- 「500ユーロ」→ amount=500 / EUR / basis未確認
- 「5万」→ amount=50000 / currency,basis未確認
- modelが推測したcurrency/basisはquoteに根拠が無ければ除去
- amount不一致は拒否
- clear / replay / conflict
- currencyまたはbasis未確認のConversation budgetをTripへ昇格しない
- what-ifはactual予算を変更しない

実モデルはNova 2 Lite＋test repositoryで、actual設定、basis訂正、what-if、basis未確定の通貨予算、clearを反復確認する。
