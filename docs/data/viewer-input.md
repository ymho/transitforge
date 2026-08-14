# ビューワー入力仕様

## ファイル

ビューワーはdata-builderが生成する時刻表2ファイルと交通スナップショット2ファイルを読む

```text
viewer-input/
├─ train_index.json
├─ path_catalog.json
├─ congestion.json
└─ delays.json
```

取得元 診断情報 中間生成物を含めない

| ファイル | 内容 |
| --- | --- |
| `train_index.json` | 列車 停車時刻 経路参照 駅と路線のカタログ |
| `path_catalog.json` | 経路参照ごとの座標列 |
| `congestion.json` | 列車番号ごとの最新混雑度 |
| `delays.json` | 列車番号ごとの最新遅延分と行き先 |

列車の`path_id`と経路の`path_id`を結合する
同じ経路を走る列車は同じ`path_id`を共有できる

## `train_index.json`

```json
{
  "schema_version": "train-index-v1",
  "path_catalog": "path_catalog.json",
  "service_date": "2026-07-12",
  "timetable_kind": "weekend_holiday",
  "station_line_catalog": {
    "schema_version": "station-line-catalog-v1",
    "source": "N02-25_Station.geojson",
    "lines": []
  },
  "trains": [
    {
      "service_uid": "JRW:20260712:782:始発駅:終着駅",
      "train_no": "782",
      "service_type": "普通",
      "train_name": "",
      "origin_station": "始発駅",
      "destination_station": "終着駅",
      "path_id": "path_a1b2c3d4e5f67890",
      "stops": []
    }
  ]
}
```

| 項目 | 内容 |
| --- | --- |
| `service_uid` | 営業日を含む列車の一意ID |
| `train_no` | 表示と遅延結合に使う列車番号 |
| `service_type` | 普通 快速 特急などの種別 |
| `train_name` | 列車名 |
| `origin_station` | 始発駅 |
| `destination_station` | 終着駅 |
| `path_id` | 経路カタログの参照ID |
| `stops` | 停車駅 時刻 経路上の位置 |

列車の識別には`train_no`ではなく`service_uid`を使う

## 停車時刻

```json
{
  "station_name": "始発駅",
  "event": "発",
  "time": "10:00",
  "normalized_time": "10:00",
  "route_meter": 0.0,
  "route_time_minutes": 600
}
```

| 項目 | 内容 |
| --- | --- |
| `station_name` | 駅名 |
| `event` | 着 発などの種別 |
| `time` | 表示用時刻 |
| `normalized_time` | 日またぎ補正後の時刻 |
| `route_meter` | 経路始点からの累積距離m |
| `route_time_minutes` | 営業日内の通算分 |

翌日1時は`25:00`と1500分のように表す
位置計算は文字列時刻ではなく`route_time_minutes`を使う

同じ駅の着時刻と発時刻は別レコードになり得る
到着から発車までは同じ`route_meter`へ配置し 走行中は前後の時刻と距離を補間する

## `path_catalog.json`

```json
{
  "schema_version": "train-path-catalog-v1",
  "paths": [
    {
      "path_id": "path_a1b2c3d4e5f67890",
      "coord_count": 57,
      "route_length_m": 4228.3,
      "bbox": [134.9, 34.6, 135.1, 34.8],
      "route_coords": [[135.0, 34.0], [135.001, 34.0005]]
    }
  ]
}
```

| 項目 | 内容 |
| --- | --- |
| `path_id` | 列車から参照する経路ID |
| `coord_count` | 座標点数 |
| `route_length_m` | 経路全長m |
| `bbox` | 最小経度 最小緯度 最大経度 最大緯度 |
| `route_coords` | 線路に沿った座標列 |

座標は`[経度, 緯度]`の順

## 駅と路線のカタログ

`station_line_catalog`は駅GeoJSONから生成して`train_index.json`へ内包する
独立ファイルとして配信しない

路線色の判定には事業者 正式路線名 所属駅 駅代表座標を使う
列車の停車駅列と行き先から対象路線を選び 判定できない場合はグレーにする

## 読み込み時の前提

- スキーマバージョンを検証
- 列車は`service_uid`で識別
- 経路は`path_id`で結合
- 時刻計算は`route_time_minutes`を使用
- 24時を超える時刻を許容
- `path_id`がない列車を表示対象外とする
- 対応する経路がない列車を安全にスキップ
- 不明な路線色をグレーで表示

## `delays.json`

```json
{
  "collectedAt": "2026-08-14T03:00:00+00:00",
  "failedSources": [],
  "trains": {
    "100A": {
      "delayMinutes": 6,
      "destination": "変更後の終着駅",
      "sources": ["source-a"]
    }
  }
}
```

現在時刻と表示時刻の両方が`collectedAt`から5分以内で `failedSources`が空の場合だけリアルタイム表示へ使う

- `trains`に存在する列車番号だけを運行中として表示する
- `delayMinutes`を時刻表上の位置へ反映する
- `destination`を行き先の正本とする
- 区間内の途中駅へ行き先が短縮された列車は赤いハローで表示する
- 同じ列車番号の通常の区間分割 環状線の方向表示 経路外の行き先は変更判定に使わない
- 取得元に失敗があるスナップショットは誤った運休判定を避けるため適用しない
- リアルタイム情報を適用できない日時は時刻表どおりに表示する
