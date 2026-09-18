# Fixtureガイド

このディレクトリには外部通信なしで再現できる小さな入力と期待結果だけを置く
各JSONは手動でレビューする正本であり 外部サービスの応答をそのまま保存しない

| ファイル | 所有する検証 | 更新後の確認 |
| --- | --- | --- |
| `journey-search-scenarios.json` | 経路探索と順位付け | `npm run test:journey-scenarios` |
| `agent-eval-cases.json` | AgentのDomain Benchmark | `npm run eval:agent:smoke`と`npm run eval:agent:full` |
| `agent-eval-observations.json` | 評価ケースで再現するTool観測 | `npm run eval:agent:full` |
| `agent-strategy-experiment.json` | Agent戦略の比較条件 | `npm run eval:agent:strategies` |

評価レポートなどの派生物は`/tmp/transitforge-agent-eval`へ生成し Gitへ追加しない

## UI比較用の参照

`ui/transitforge_ai_first_mock_v6.html` は利用者提供のv6デザイン参照（2026-09-18）。
本番からimportせず、固定データ・JavaScriptは画面比較の参照ブラウザ内だけで実行する。
`tools/capture_product_design.mjs` が同じChromium/viewportで本番共通UIの開発previewと比較する。
画像は生成物としてGitへ入れず、CI / Testの手動 `visual_comparison` 入力でartifactを取得する。
自動pixel合否ではない。画像・実装の操作・実データ境界を別々にレビューする。

Trip Progressの複数turnシナリオ定義（相談文・閾値・tag）は`agent-eval-cases.json`の
`travelProgressScenarios`に置く（dataset-v2、旧v1 reader互換）。実行用fixtureは本番Runtimeと
colocateする`frontend/src/adapters/bedrock/travel-progress-scenarios.fixture.ts`に置く。
#384のA〜G fixtureと`modules/trip/domain/selected-rail-journey.fixture.ts`を再利用し、
架空の地点・宿・時刻表だけを与える。実Providerの録音・本番会話・画像は含めない。
Smokeは15件、FullはA〜AEの31件（K/LはActivity、M/NはTripParty、O/PはTransport、Q/RはAccommodation、SはEUR価格観測、T/Uは多都市、V〜Zは候補評価、AAはUI focus、ABは予約、AC〜AEはTrip成立性）。地点順序の共有fixtureは`modules/trip/domain/trip-places.fixture.ts`に置く。地名だけを使うsyntheticデータで実時刻表・宿泊商品ではない。JSON/Markdownの同じ指標を出力し、詳細定義は
[Trip Progress評価](../../docs/architecture/trip-progress-evaluation.md)を参照する。

## 経路検索シナリオ

`journey-search-scenarios.json`は外部データを使わない小さな時刻表と期待結果を持つ

## 列車

`services`へ列車を追加し `stops`へ停車駅を順番に書く
始発側は`departure` 終着側は`arrival`が必須
途中駅には両方を指定できる
時刻は午前0時からの分数で 24時以降は1440以上を使う

```json
{
  "id": "sample",
  "trainNumber": "10M",
  "stops": [
    { "station": "A", "departure": 600 },
    { "station": "B", "arrival": 610, "departure": 612 },
    { "station": "C", "arrival": 625 }
  ]
}
```

## 検索条件

`request`へ発着駅 希望時刻 最大乗換回数を指定する
必要に応じて`transferPace`と`rankingPreference`を追加する

## 期待結果

`expect.journeyCount`で候補数を確認する
`firstJourney`で先頭候補の列車 発着時刻 乗換回数 乗換駅を確認する
除外理由は`traceMinimum`で最低発生回数を確認できる

## 実行

```bash
npm run test:journey-scenarios
```
