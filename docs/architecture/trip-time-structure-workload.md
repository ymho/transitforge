# Tripの時間・日・区間・負荷契約

## 正本と派生

| 情報 | 正本 | 派生read model |
| --- | --- | --- |
| 採用済み予定 | `Trip.items[].schedule` | `DailyItineraryProjection` |
| 日付未定の相対日 | `Trip.timeline.logicalDays` + `relative` schedule | logical dayの`DayView` |
| 暦日対応 | 明示または明示anchor policyによる`calendarBindings` | local date/zone付き`DayView` |
| 滞在・都市間・日帰り | item/Place occurrence | `TripStructureProjection` |
| 区間名・物流依存 | `Trip.structureIntent` | revision-bound segment/relation |
| 負荷 | item、日別projection、根拠付きmovement fact | `TripWorkload` |

`DayView`やworkloadを編集・保存の第二正本にしない。すべて`sourceTripId/sourceRevision/sourceItemId`へ戻せる。

## 時間精度

- `fixed`: offsetとIANA zoneが一致するinstant。実経過時間を計算できる。
- `window`: 配置可能範囲。earliestへ固定しない。
- `day`: calendar date。時刻0:00へ固定しない。stayのendDateはcheckoutの排他的境界。
- `relative`: logical dayと任意の概念的時間帯・duration range。calendar dateはbindingがあるときだけ得る。
- `unscheduled`: 日にも配置されていない。

bindingの生成は明示anchor・date・zoneを必須とする。タイトルや地名からzoneを推測しない。sequential bindingはpureに解除でき、
logical day参照は変わらない。異なるlogical dayが同じlocal dateになることを禁止しない。

## 日別projection

連泊はcheck-in=`start`、中日=`continue`、checkout=`end`、夜行は出発=`start`、到着=`end`として表示する。
window跨日は`possible-window`であり確定占有ではない。`entryKey`は表示単位、`sourceItemId`は編集・予約・費用単位である。
空のlogical dayは`not-planned`、未配置は`unscheduled`へ分離する。paginationはcoverage/omitted count/continuationを返す。

## scopeと負荷

`ConstraintScope`はtrip/item/item-set/logical-day/all-days/segmentと任意anonymous participantを扱う。
存在しない参照、空scope、不明participantは成立扱いにしない。同一scopeの相反するuser hard条件はconflictingとして両方残す。

workloadはtravel、walking、transfer、fixed appointment、lodging change、early/late、slack、continuous activityを別Measureとして返す。
各Measureはlower/upper、complete/partial/unknown、source item、observation、除外理由を持つ。日別travelはIANA zoneの日境界で
instant intervalをclipするため、DSTの日を常に1,440分として扱わない。表示entryの複製は旅行全体合計へ加算しない。

本番Server State loaderは`createAgentContextSnapshot`を通じ、先頭6日とcoverage/continuation、revision-boundな区間、
coverage付きworkloadを同じAgent Contextへ渡す。残りの日を「存在しない予定」とせず、後続の段階取得契約へ引き継ぐ。
