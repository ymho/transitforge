# ビューワー入力データ仕様

## 1. 入力ファイル

ビューワーが読み込むファイルは、次の2つです。

```text
viewer-input/
├─ train_index.json
└─ path_catalog.json
```

`train_index.json`と`path_catalog.json`は`transitforge-data-builder`が生成する
ビューワー向け公開成果物です。取得元や経路生成の診断情報は含めません。

| ファイル | 内容 |
|---|---|
| `train_index.json` | 列車情報、停車時刻、経路参照ID、駅・路線所属カタログ |
| `path_catalog.json` | 経路参照IDごとの座標列 |

- 文字コード：UTF-8
- データ形式：JSON
- 座標形式：`[経度, 緯度]`

## 2. ファイル間の関係

`train_index.json` の各列車が持つ `path_id` を使い、`path_catalog.json` から経路座標を取得します。

```text
train_index.json
  trains[].path_id
          │
          ▼
path_catalog.json
  paths[].path_id
          │
          ▼
  paths[].route_coords
```

同じ経路を走る複数の列車は、同じ `path_id` を共有します。

## 3. `train_index.json`

### 構造

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

### 列車項目

| 項目 | 内容 |
|---|---|
| `service_uid` | 列車を一意に識別するID |
| `train_no` | 列車番号 |
| `service_type` | 普通、快速、特急などの種別 |
| `train_name` | 列車名 |
| `origin_station` | 始発駅 |
| `destination_station` | 終着駅 |
| `path_id` | `path_catalog.json` 内の経路を参照するID |
| `stops` | 停車駅、時刻、経路上の位置 |

列車の一意キーには、`train_no` ではなく `service_uid` を使用します。

## 4. `stops`

各列車の `stops` には、停車駅、時刻、経路上の位置が入ります。

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
|---|---|
| `station_name` | 駅名 |
| `event` | `着`、`発` などの時刻種別 |
| `time` | 表示用時刻 |
| `normalized_time` | 日またぎを補正した時刻 |
| `route_meter` | 経路始点から駅までの累積距離（m） |
| `route_time_minutes` | 列車位置計算に使う通算時刻（分） |

翌日1時は、例えば次のように表現されます。

```json
{
  "normalized_time": "25:00",
  "route_time_minutes": 1500
}
```

ビューワーの時刻計算には、文字列の `time` よりも `route_time_minutes` を使用します。

同じ駅に着時刻と発時刻がある場合は、`着` と `発` が別レコードになることがあります。

## 5. `path_catalog.json`

### 構造

```json
{
  "schema_version": "train-path-catalog-v1",
  "paths": [
    {
      "path_id": "path_a1b2c3d4e5f67890",
      "coord_count": 57,
      "route_length_m": 4228.3,
      "bbox": [134.9, 34.6, 135.1, 34.8],
      "route_coords": [
        [135.0000, 34.0000],
        [135.0010, 34.0005],
        [135.0020, 34.0010]
      ]
    }
  ]
}
```

### 経路項目

| 項目 | 内容 |
|---|---|
| `path_id` | 列車側から参照される経路ID |
| `coord_count` | 経路を構成する座標点数 |
| `route_length_m` | 経路全長（m） |
| `bbox` | `[最小経度, 最小緯度, 最大経度, 最大緯度]` |
| `route_coords` | 線路に沿った座標列 |

座標は `[緯度, 経度]` ではなく、`[経度, 緯度]` です。

```json
[135.0000, 34.0000]
```

## 6. `station_line_catalog`

`transitforge-data-builder`が国土数値情報の`N02-25_Station.geojson`から生成し、
`train_index.json`へ内包する派生データです。独立したS3オブジェクトにはしません。

```json
{
  "schema_version": "station-line-catalog-v1",
  "source": "N02-25_Station.geojson",
  "lines": [
    {
      "operator": "西日本旅客鉄道",
      "line": "奈良線",
      "stations": [
        {
          "name": "京都",
          "coordinate": [135.759, 34.985]
        }
      ]
    }
  ]
}
```

列車の行き先駅が所属する路線を候補とし、その列車の停車駅列との一致から
到着路線を選びます。同じ正式路線内で地域別ラインカラーが異なる場合は、
行き先駅と直前の同一路線駅の代表座標から区間を判定します。添付路線図から
色を確定できない路線はグレーで表示します。

事業者名はUnicode表記を正規化します。`WILLER　TRAINS` は
`京都丹後鉄道`、全角の `ＩＲいしかわ鉄道` は `IRいしかわ鉄道` として
カタログへ収録します。

## 7. ビューワーでの読み込み

```javascript
const trainIndex = await fetch("train_index.json").then(response =>
  response.json()
);

const pathCatalog = await fetch(trainIndex.path_catalog).then(response =>
  response.json()
);

const pathsById = new Map(
  pathCatalog.paths.map(path => [path.path_id, path])
);

for (const train of trainIndex.trains) {
  const path = pathsById.get(train.path_id);

  if (!path) {
    continue;
  }

  const routeCoords = path.route_coords;
}
```

処理の流れは次のとおりです。

1. `train_index.json` を読む。
2. `path_catalog.json` を読む。
3. `path_id` をキーに経路を検索できるようにする。
4. 各列車の `path_id` から `route_coords` を取得する。
5. `stops` の時刻と `route_meter` から現在位置を計算する。

## 8. 列車位置の計算

`route_coords` の各座標点には時刻情報を持たせていません。

時刻と位置の対応は `stops` に保持します。

```text
10:00  route_meter = 0m
10:05  route_meter = 4,000m
```

現在時刻が10:02:30の場合は、前後の時刻から走行距離を補間します。

```text
前の停車時刻・距離
        ↓
時間比率から現在距離を計算
        ↓
route_coords上の現在座標を計算
```

停車中は、到着時刻から発車時刻まで同じ `route_meter` に列車を配置します。

## 9. ビューワー側の前提

- 列車の一意キーには `service_uid` を使用する。
- 経路との結合には `path_id` を使用する。
- 座標は `[経度, 緯度]` として扱う。
- 時刻計算には `route_time_minutes` を使用する。
- 24時を超える時刻を許容する。
- `path_id` がない列車は表示対象外にする。
- 対応する経路が見つからない列車は安全にスキップする。
- ラインカラーの判定は駅・路線カタログを使用し、不明な色はグレーにする。

## 10. 要約

```text
train_index.json
  = 列車、時刻表、停車位置、使用する経路ID

path_catalog.json
  = 経路IDに対応する地図上の座標列

train_index.json.station_line_catalog
  = 対象事業者の路線、所属駅、駅代表座標
```

ビューワーは、列車と経路を `path_id` で結合して現在位置を計算し、
駅・路線カタログから到着路線と車体色を判定します。
