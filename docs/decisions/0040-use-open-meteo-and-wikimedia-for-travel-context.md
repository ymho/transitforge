# ADR 0040 Open-MeteoとWikimediaで旅行文脈を補う

## 状態

採用

## 決定

旅行日の時間別 日別予報はOpen-Meteo Forecast APIから取得する
地名解決もOpen-Meteo Geocoding APIを使い 旅行期間が予報範囲外なら値を補完せずunknownとして扱う
結果は1時間を目安にfreshとし Providerの更新時刻とsource URLをEvidenceへ残す

Viewerの局地天気は日本全体の固定サンプル地点を Open-Meteoの複数座標検索で1回だけ先読みする
自動取得は緯度20〜46度 経度122〜154度の日本域に限定し 域外では取得も描画もしない
デジタルツインでは現在値を10分間隔と地図移動後に更新し 日時指定では予報範囲内の表示日時を使う
地図移動時は外部取得を行わず 地図中心に最も近い先読み地点の天気をMapboxのRain Snow Fogで即座に反映する
ズーム7以上では表示範囲を2×2 3×3 4×4へ段階的に分けて移動停止後に追加取得する
詳細取得中と失敗時は全国の先読み結果を維持し 地図操作を外部通信で待たせない
Mapboxの天候表現は画面全体へ適用されるため 同一画面内の天候境界と雨雲レーダーの形状や移動は対象外とする

観光地の基礎情報 座標 写真は日本語WikipediaとWikimedia Commonsから取得する
画像は恒久保存せず URL creator license attribution description URLを一緒に保持する
表示時はattributionを省略せず Providerが利用条件を返さない画像は表示対象にしない

観光地の地点ID 座標 カテゴリに関するこの判断は[ADR 0041](0041-use-mapbox-poi-as-place-identity.md)で置き換えた
WikipediaとWikimedia Commonsは一致した地点の説明と画像の補完として維持する

観光写真の補完は[ADR 0050](0050-use-web-image-search-for-place-photos.md)で置き換えた

## 理由

両APIは公開仕様があり Provider固有応答をDomain Contractへ正規化できる
Raiquoraは天気予報や観光情報を自前生成せず 取得失敗 stale unknownを区別する
複数座標をまとめることで 地図操作時の外部リクエストと待ち時間をなくしながら地域差を表現できる

## 参照

- https://open-meteo.com/en/docs
- https://www.mediawiki.org/wiki/API:Geosearch
- https://www.mediawiki.org/wiki/API:Imageinfo
