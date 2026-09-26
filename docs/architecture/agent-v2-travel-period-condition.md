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

日付入力は次の表現だけを許可する。

- `local_date`: 年月日が明示された場合。
- `month_day`: 年なしの月日。
- `day_of_month`: 開始日と同じ月で終了日の「5日」のように日だけが明示された場合。
- `relative_date`: 今日 / 明日 / 明後日。

日数は`days`または`nights`で、明示された整数だけを受け取る。

モデルは暦日を確定する権限を持たない。年なし月日と相対日付はApplicationがtrusted `calendarDate`から解決し、解決済み値だけをConversation Intentへ保存する。相対表現にcalendar anchorが無ければ受理しない。

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

決定論的テストでは、月日解決、相対日付解決、start/endの同一A commit、durationの非推測、clear、矛盾拒否、journal replay、transaction failure時の非partialを確認する。

実モデルはNova 2 Lite＋test repositoryで、actual期間設定、訂正、what-ifで非永続scenarioを選ぶこと、明示clearを反復確認する。固定fixtureの成功を実Providerや実ブラウザの成功とは扱わない。
