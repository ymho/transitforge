# Legacy TripPlanPatchの原子的適用 (#405)

親方針は [#382](https://github.com/ymho/transitforge/issues/382) と
[#415](https://github.com/ymho/transitforge/issues/415)、担当は
[#405](https://github.com/ymho/transitforge/issues/405)。Trip V2実装ではなく現行TripPlanの先行修正である。

## Domain契約

| Patch | 意味 |
| --- | --- |
| add | その時点で存在しないIDを追加。重複は拒否 |
| replace | その時点で存在するitemIdのみ置換。対象の安定IDを保持し、payloadのitem.idで改名しない。upsert禁止 |
| remove | 存在するitemIdのみ削除。不在は拒否 |
| move | 存在するitemIdを移動。afterId不在・自分自身の後ろは拒否 |
| metadata | title/destination/conditionsの指定値を変更。他のPatchが不正ならこれも適用しない |

add/moveのafterId省略は従来どおり末尾へ配置する。明示した空文字や存在しないafterIdを省略扱いにしない。
Patch列は順序を持ち、前のadd/removeの結果を後続の参照検証に反映する。
remove後の同IDの明示addは可能だが、replaceやmoveで削除済みIDを参照することはできない。
元planの重複IDも参照が曖昧なので拒否する。

`applyTripPlanPatches`はまず`validateTripPlanPatches`で列全体を検証し、失敗ならreason付きErrorをthrowする。
成功時だけ新しい配列/planを構築する。元plan、item、入力Patchを変更せず、途中の結果を返さない。
applyに独立した「重複ならskip」「replace不在ならadd」「move不在なら無視」を残さない。
validatorを通す責務を呼び出し元だけに任せない。

この契約は型付けされたTripPlanPatchの操作・参照のinvariantを扱う。外部JSONのshape検証と
Evidence/Claim validationを置き換えるものではない。revisionや再送の冪等性は#389で導入する。

## 呼び出し元の棚卸し

main `31a6517`の全参照を確認した。

- **実際のapply入口**: `presentation/trip-plan/trip-plan-panel.ts`。
  同期的に同じvalidatorで確認してからapply/save/renderする。不正列では保存・描画を行わない。
  DOMとStorageを使う回帰テストで、metadata+不正replaceが部分反映されないことを確認する。
- **AI提案の入力**: `adapters/bedrock/viewer-agent-runtime.ts`の`propose_trip_update`。
  従来は不正操作だけのflatMap除外・12件への切捨て・不正afterIdの削除があった。
  不正/過大な列は全体拒否とし、参照を勝手に省略せずDomain validatorへ渡す。
  Tool errorとしてRuntimeへ返し、再計画はモデルに委ねる。固定会話フローは追加しない。
- **暗黙upsert依存**: `tripPlanPatchesFromTravelPlan`は往路/宿/帰路へ常にreplaceを生成していた。
  現在のTripPlanを必須引数にし、存在時だけreplace、不在時は明示addにする。
  日帰り変更のremoveもstay存在時だけ生成する。2か所の`travelResponseText`呼び出しを更新する。
  観光のみ→旅程、日帰り→宿泊、宿泊→日帰り、日帰りの再検索をテストする。
- **特定経路の再検索**: `search_trip_route_update`は対象movementの存在を確認してreplaceする。
  立寄り後の区間は新IDの明示addを既に使っており、upsert依存はない。
- **UI経由**: ai-guide-panel → composition → tripPlanController.applyで同じDomain契約へ到達する。
  宿の選択は別の既存Domain関数であり、今回Patch方式へ改修しない。

別課題候補: ai-guide-panelの反映ボタンはcallbackの成否を受け取らず「反映済み」にする。
不正な古い提案はcontrollerで拒否され保存されないが、失敗表示/戻り値の連携は別のUI改善として扱う。

## 検証・後続責務

Domainでは参照エラー各種、metadataを含む原子性、安定ID、順序、削除後の再追加を確認する。
10操作から生成した長さ3の1,000列でvalidate成功→apply成功と、不正時の入力不変を確認する。
Agentの不正列は部分提案を返さず、UIは不正列を保存しないことを境界テストで確認する。

保存形式・version・LocalStorageは変更しない。#385のTrip骨格・SelectedRailJourney・候補分離・
legacy→V2 converter、#389のrevision/baseRevision/mutationId、#388のserver persistenceは未着手。
#415の最終契約を変更せず、旧暗黙upsertを期待したテストは今回の正しい契約へ置き換える。
