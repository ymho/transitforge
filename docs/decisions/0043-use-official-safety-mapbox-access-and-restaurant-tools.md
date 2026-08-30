# ADR 0043 防災 駅から先の移動 食事を独立した旅行Toolにする

## 状態

採用

## 決定

旅行計画に不足している安全情報 鉄道駅から目的地までの移動 食事候補を次のProviderへ接続する

- 警報 台風 地震 津波 火山は気象庁防災情報XML
- 徒歩 車 自転車の経路 比較 到達圏はMapbox Directions Matrix Isochrone
- 飲食店候補はホットペッパーグルメ Webサービス

各Provider固有応答はBackend Adapterへ閉じ `modules/trip/domain` のProvider非依存モデルへ正規化する
Agentは `search_travel_alerts` `search_ground_access` `search_restaurants` を使い Source Evidenceと
Structured Traceを残す

鉄道経路は既存の時刻表と運行情報によるDomain Logicを正本とし Mapbox Navigationで再検索しない
徒歩等の端点は同じAgent実行で確認した駅またはMapbox Place IDだけを許可し モデルが任意座標を指定できないようにする

気象庁の高頻度Atomフィードは1分キャッシュし 取得サイズ 件数 timeoutを制限する
フィードに一致する情報がないことは安全の保証として扱わない

飲食店の予算 営業時間 写真はProviderに値がある場合だけ表示し 空席 予約可否 価格を推測しない
地図へ表示する場合はMapbox Placeへ照合できた候補だけを使う
子ども可 禁煙 バリアフリー 駐車場 個室 カード ランチ 深夜営業は
プロフィールまたは今回条件で必要な項目だけを構造化して検索する
ProviderがHTTP 200で返す認証・入力エラーも本文のerror codeで判定し 候補0件と混同しない

## 理由

Open-Meteoだけでは公式警報を扱えず 鉄道経路だけでは駅から目的地までの実行可能性を評価できない
汎用Web検索だけでは飲食店のジャンル 予算 営業情報を安定した構造で比較しにくい

3つを別Toolにすることで Agentが必要な情報だけを選び Provider障害や未観測を区別して評価できる

## 影響

- 気象庁XMLはAPIキー不要
- Mapbox Navigationは既存のBackend用Mapbox Tokenと利用上限を使う
- Secretへ `hot_pepper_api_key` を追加する
- 各Providerの帰属表示を設定画面と結果カードへ表示する
- 外部API失敗時も検証済みの鉄道経路と旅程を失わない

## 参照

- https://xml.kishou.go.jp/xmlpull.html
- https://docs.mapbox.com/api/navigation/directions/
- https://docs.mapbox.com/api/navigation/matrix/
- https://docs.mapbox.com/api/navigation/isochrone/
- https://webservice.recruit.co.jp/doc/hotpepper/reference.html
