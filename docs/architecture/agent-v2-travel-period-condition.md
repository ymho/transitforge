# Agent v2の旅行期間条件

関連: #716 / #724 / #728 / #730。V2基準モデルはADR 0098のNova 2 Lite。

## 境界

開始日・終了日・日数は、モデルから見れば別々のwriterではなく、今回の旅行期間という1つの業務条件である。

モデルへ公開する永続変更操作は`update_current_travel_period`の1つだけ。

- `action=set`: 今回の旅行期間の最終状態を設定・訂正する。
- `action=clear`: 今回の旅行期間全体を未定へ戻す。

start/end/durationを複数Toolへ分けない。1回の呼出しをApplicationが1つのbusiness slot `travel_period`として受理し、Domainではstart_date/end_date/durationの最大3操作へ展開する。3操作は同じgroupIdを持ち、1 receipt / 1 DynamoDB transaction / 1 Intent revisionで原子的に適用される。

## Model input

`action=set`のperiodには利用者が今回の発言で明示した要素だけを入れる。省略した要素は未設定へ戻し、以前の期間値と黙って混在させない。

日付入力は`calendar_date`または`relative_date`だけとする。

- `calendar_date`: dayは必須。monthは明示された場合、またはendがstartと同月で日だけ明示された場合に使う。yearは利用者が年を明示した場合だけ権威を持つ。
- `relative_date`: 今日 / 明日 / 明後日。

旅行期間全体のquoteを唯一のsource substringとして使い、Applicationがそこに月・日・泊数/日数が実在するか決定論的に検証する。前turnのdurationなど、今回発言に根拠がない任意要素は今回のperiodへ持ち越さない。モデルへ日付ごとのquote切り出しは要求しない。

年が明示されていない月日は、Applicationがtrusted `calendarDate`を基準に**その日以降で最初に到来する月日**へ機械的に解決する。たとえば基準日2026-09-26なら12/25は2026-12-25、1/21は2027-01-21である。モデルが推測したyear値は対応する部分quoteに年が無ければ無視する。明示年がある場合だけその年を使う。相対表現にcalendar anchorが無ければ受理しない。

日数は`days`または`nights`で、今回発言に明示された整数だけを受け取る。

## 整合性

- startとendが両方ある場合、end < startは拒否する。
- start/end/durationがすべて明示されている場合、nightsは日付差、daysは両端を含む日数と一致しなければ拒否する。
- start+durationだけからendを生成しない。
- start+endだけからdurationを生成しない。
- 期間全体のclearはstart_date/end_date/durationを同一atomic groupでretractする。

これらはAgentの意味理解を補修する規則ではなく、Applicationが受理できる旅行期間の業務整合性である。

## Journal / replay

condition journalの永続形式は既存version 1を維持する。既存の`target`フィールドはbusiness slotとして読み、origin/destination/party_sizeの既存receiptもそのまま読める。

`travel_period`だけは1 journal entryに3 receipt operationsを持つ。

- mutationId: `condition:<turnId>:travel_period`
- groupId: mutationIdと同じ
- operationId: `<mutationId>:start_date|end_date|duration`

同じturn/slot/同じ最終状態はreceipt replay、同じslot/異payloadはconflict。SDK toolUseId、モデルcycle、呼出順は業務IDに使わない。

## Scenario

仮定・反実仮想・what-ifは永続writerへ流さず、partyと共通の`consider_trip_scenario`を使う。このToolはA commit、Intent revision、Profile、Tripを変更しない。

## V1からの分離

V1 semantic interpreter、旧semantic corpus、V1 runtime testsを互換oracleにしない。旧calendar helperを呼び戻さず、旅行期間の公開Zod契約、Application暦解決、pure reducer、CAS/replay、後続read/publicationをV2の受入基準とする。

## 検証

決定論的テストでは、最初の未来月日解決、明示年、相対日付解決、外側quote grounding、start/endの同一A commit、durationの非推測/非持越し、clear、矛盾拒否、journal replay、transaction failure時の非partialを確認する。

実モデルはNova 2 Lite＋test repositoryで、actual期間設定、訂正、what-ifで非永続scenarioを選ぶこと、明示clearを反復確認する。固定fixtureの成功を実Providerや実ブラウザの成功とは扱わない。


## 実モデル結果

Nova 2 Lite final travel-period live run 36280727426を3回独立実行し、3/3 PASSした。各反復で以下を確認した。

- 挨拶: 条件更新なし
- 「明日から2日間」: `update_current_travel_period` 1回、trusted calendarからstartを解決
- 「10月3日から5日までに変更」: `update_current_travel_period` 1回、年未指定を基準日以降の最初の月日へ解決し、旧durationを持ち越さない
- 「もし1週間なら」: `consider_trip_scenario`のみ。accepted operation数・actual期間は不変
- 「日程は未定に戻して」: `update_current_travel_period(action=clear)`
- お礼: 条件更新なし

各actual更新は2 model calls（writer→structured output）、what-ifも2 calls、更新不要turnは1 callだった。固定test repositoryでの結果であり、実Provider・実ブラウザとは区別する。
