# ADR 0041 Mapbox POIを観光地点の正本にする

## 状態

採用

## 決定

観光候補の地点ID 名称 座標 カテゴリはMapbox Search Box APIのPOIを正本にする
検索時は日本と日本語を指定し `types=poi`で行政区画や一般記事を除外する
地理条件がある場合は近接座標を渡し 同一地点はMapbox Place IDで重複を除く

日本語WikipediaとWikimedia Commonsは Mapboxで同定した地点と名称が一致した場合に限り
説明と利用条件が明らかな画像を補完する。Wikipediaの座標やページIDでMapboxの地点を
上書きしない。Mapboxを利用できない環境では既存機能を失わないためWikipediaへフォールバックするが
本番の地図候補はMapbox Searchの設定を標準とする

Wikipediaによる写真補完とfallback結果の説明表示は
[ADR 0050](0050-use-web-image-search-for-place-photos.md)で置き換えた

Mapbox Search用Tokenは既存の旅行Provider用Secrets Managerへ任意項目として保存し
専用Credentials Repositoryで読む。他の旅行Providerの認証項目をMapboxへ要求せず
TokenやTokenを含むリクエストURLをEvidence Trace ログへ保存しない
Viewerと同じURL制限付き公開Tokenを共有する場合 BackendのMapbox通信は正規Viewer URLを`Referer`に設定する
この通信方針は共通Mapbox HTTP Adapterへ集約する

## 理由

Wikipedia検索は説明と画像の補完に向く一方 検索語に近い市 県 一般記事も候補になり
施設の地点同定には不十分だった。Viewerと同じ地理基盤のPOIを正本にすることで
地図上の位置と施設カテゴリを検証可能な単位へ揃えられる

Mapbox固有応答はBackend Adapterへ隔離し DomainとAgent Toolは既存の
`PlaceMediaProvider`契約を維持する。後続のWeb検索もMapboxへ直接依存せず
抽出した施設名をPlace検索のヒントとして渡す

## 影響

- Search Box APIの利用量と利用条件を監視する必要がある
- Search Boxの結果は恒久的な地点データとして保存せず実行中の提案へ使う
- 写真や説明が見つからないPOIは未取得項目を推測せず地点情報だけを返す
- Google Placesの結果をMapbox上へ転載しない

## 置き換える判断

[ADR 0040](0040-use-open-meteo-and-wikimedia-for-travel-context.md)のうち
「観光地の座標をWikipediaから取得する」という判断を置き換える

## 参照

- https://docs.mapbox.com/api/search/search-box/
- https://docs.mapbox.com/help/troubleshooting/japan-specific-considerations-search-api/
- https://developers.google.com/maps/documentation/places/web-service/policies
