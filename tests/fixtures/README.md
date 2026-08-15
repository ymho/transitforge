# 経路検索シナリオ

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
python3 tools/run_journey_search_scenarios.py
python3 tools/run_journey_search_scenarios.py sample
```
