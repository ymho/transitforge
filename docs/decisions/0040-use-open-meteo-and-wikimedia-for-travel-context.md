# ADR 0040 Open-MeteoとWikimediaで旅行文脈を補う

## 状態

採用

## 決定

旅行日の時間別 日別予報はOpen-Meteo Forecast APIから取得する
地名解決もOpen-Meteo Geocoding APIを使い 旅行期間が予報範囲外なら値を補完せずunknownとして扱う
結果は1時間を目安にfreshとし Providerの更新時刻とsource URLをEvidenceへ残す

観光地の基礎情報 座標 写真は日本語WikipediaとWikimedia Commonsから取得する
画像は恒久保存せず URL creator license attribution description URLを一緒に保持する
表示時はattributionを省略せず Providerが利用条件を返さない画像は表示対象にしない

## 理由

両APIは公開仕様があり Provider固有応答をDomain Contractへ正規化できる
Raiquoraは天気予報や観光情報を自前生成せず 取得失敗 stale unknownを区別する

## 参照

- https://open-meteo.com/en/docs
- https://www.mediawiki.org/wiki/API:Geosearch
- https://www.mediawiki.org/wiki/API:Imageinfo
