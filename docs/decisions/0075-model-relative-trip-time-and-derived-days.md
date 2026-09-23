# ADR 0075: 相対時間をTrip意図として保持し日別表示と負荷を導出する

- ステータス: Accepted
- 日付: 2026-09-23
- 対象: #540, #541, #542, #543, #544

## 背景

Trip V2の`fixed/window/day/unscheduled`は確定した予定を正確に扱える一方、日付未定の「2日目午後」を保存できなかった。
UIは開始日だけでitemをbucket化し、連泊・夜行の継続やcheckoutを表示できなかった。日別配列を保存型へ追加すると
`Trip.items`と二重正本になり、費用・予約・移動を日数分だけ複製する危険がある。

## 決定

- `Trip.items`と各itemのscheduleを編集正本として維持する。
- Trip V3は小さい`timeline`だけを追加し、stable logical dayの順序と明示的calendar bindingを所有する。
- `ItinerarySchedule.relative`はlogical day、概念的時間帯、所要時間幅を保持する。bindingしても午後を固定時刻へ変換しない。
- `projectDailyItinerary`は`entryKey`と`sourceItemId`を分け、連泊・夜行を複数の表示entryへ投影する。編集・費用・予約は常にsource itemへ戻る。
- 滞在区間・都市間移動・物流依存は`projectTripStructure`で導出する。利用者が明示した区間名と依存だけを小さい`structureIntent`として保存し、derived graphは保存しない。
- 条件scopeはtrip/itemに加えてlogical day/all days/item set/segment/anonymous participantを扱う。既存`maxTravelMinutes`は各移動上限のまま維持し、日合計は`aggregate_metric`で別表現にする。
- workloadは再現可能な複数指標とcoverageを返し、単一疲労点へ潰さない。未知区間は0ではなくpartial/unknownになる。

## 時間と互換性

実経過時間はoffset付きinstantの差、日別表示は各IANA zoneのlocal dateを使う。DST fold/gap、日付変更線、鉄道業務日を
同じ計算へ混ぜない。selected rail/stayの既存Snapshot整合検証は変更しない。

V2は段階切替中もlosslessに読める。timeline/structure intentを持つwriter出力だけをV3とし、`upgradeTripV2`はCAS writerが
明示的に利用するpure migrationである。Browser legacy migrationや別のdays writerは作らない。

## 影響

- 同じ宿を4日に表示しても宿・予約・費用は1件のままになる。
- 日付未定の意図を捏造せず保存できる一方、calendar bindingがなければ時刻依存評価はunknownになる。
- 日別projectionは最大90日、既定31日でcontinuationを返し、30日旅程を全量モデル入力へ固定しない。
- algorithmは概ね`O(items log items + days * items)`で、#560のstress計測へ引き継ぐ。

## 検証

相対日の保存・binding解除、閏年、DST fold、日付変更線、夜行、3連泊、空白日、unscheduled、scope別集計、
未知移動、物流依存をpure testで固定する。workspace UIは同じprojectorを使い、DOM keyはentry、操作対象はsource itemとする。
