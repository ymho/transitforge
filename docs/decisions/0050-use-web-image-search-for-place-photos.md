# ADR 0050 観光写真をWeb画像検索で補う

## 状態

採用

## 決定

観光候補の地点ID 名称 座標 カテゴリは引き続きMapbox Search Box APIのPOIを正本にする
Mapbox Searchが未設定の環境ではWikipediaを地点同定だけのfallbackに使い 写真 説明 詳細は採用しない
POI名をBrave Image Search APIで検索し Braveが返すプロキシ済みサムネイルを会話内の代表写真として使う
画像の掲載元ページURLを写真と一緒に保持し 写真全体をそのページへのリンクとして表示する

会話内へ表示するのは検索順位が最上位の表示可能な写真1枚とし 写真上へ地点名や出典テロップを重ねない
検索には日本と日本語を指定し SafeSearchをstrictにする
HTTPSの写真URLと掲載元ページURLが揃わない結果は表示しない
写真と検索結果は恒久保存せず 画像検索に失敗した場合は写真を表示せず 地点候補だけを維持する

地点を取得できない場合は Web画像検索の結果を地点候補として代用しない
これにより一般記事や行政区画が観光地点として混ざる経路をなくす

## 理由

WikipediaとWikimedia Commonsへ限定した画像は選択肢が狭く 帰属テロップを写真へ重ねることで
会話内で写真そのものを見たい利用者の体験を損なっていた
既存のWikipedia画像へ固定すると写真の選択肢が狭くなる
既存のBrave Search認証をImage Searchでも共有すれば
新しい認証境界を増やさず 通常のWeb上の写真を発見できる
掲載元は写真をタップした時に確認できるため 写真上の常設テロップを不要にできる

## 影響

- Brave Search APIの利用量に画像検索も加わる
- Braveのプロキシ済みサムネイルを使い 元サイトへ画像取得アクセスを直接発生させない
- 画像検索結果の利用可否と掲載元ページの内容は提供元に依存する
- Wikipedia/Wikimediaの画像は本番の既定経路から外し 地点同定fallbackの結果からも除去する

## 置き換える判断

[ADR 0040](0040-use-open-meteo-and-wikimedia-for-travel-context.md)のうち
「観光写真をWikipediaとWikimedia Commonsから取得する」という判断を置き換える
[ADR 0041](0041-use-mapbox-poi-as-place-identity.md)のWikipedia画像補完を置き換える

## 参照

- https://api-dashboard.search.brave.com/api-reference/images/image_search
- https://api-dashboard.search.brave.com/app/documentation/image-search/responses
