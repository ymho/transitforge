# ADR 0042 Web検索とページ読解をboundedなToolへ分離する

## 状態

採用

## 決定

Web上の観光候補と最新情報は `search_web` で発見し `read_web_pages` で上位ページを読む
検索と読解を一つのToolへまとめず Agentが検索結果を確認してから読むURLを選ぶ

検索ベンダーは `WebSearchProvider` Portの外へ漏らさず 最初のAdapterにはBrave Search APIを使う
Google Custom Search JSON APIは新規利用を受け付けず2027年に終了予定のため採用しない
検索Keyは既存の旅行Provider用Secrets Managerへ任意項目として保存する

ページ読解はHTTPSの公開URLだけを対象にする。DNS解決結果のprivate link-local loopback範囲
標準外Port 認証情報付きURLを拒否し redirect先も再検証する。最大4ページ 1ページ384KiB
抽出本文6,000文字 8秒で制限し HTMLのscript style iframeなどを除去する

取得本文には `untrustedExternalContent` を付け 本文中の命令をAgentの指示として扱わない
Web情報を利用者向けの事実へ使う場合はURLと取得日時をEvidenceへ残す
検索結果だけで地点の座標 営業時間 実行可能性を確定せず 地図表示はMapbox POIとの照合後に行う

## 理由

検索Snippetだけでは公式情報や文脈を確認できず 一つのページだけでは誤りや古さを判断しにくい
一方で任意URLの無制限取得はSSRF Prompt Injection Token増大のリスクがある
検索 読解 地点照合を分離することで各段階をTraceとEvalで確認できる

## 影響

- Brave Searchの利用量と費用上限を外部サービス側で設定する
- robots 利用規約 ログイン Paywallを回避しない
- Web本文全文を永続化せず Agent Traceもboundedな結果だけを扱う
- Node標準fetchのDNS再解決を完全には固定できないため private networkへ到達できないVPC egress制御も維持する

## 参照

- https://api-dashboard.search.brave.com/app/documentation/web-search
- https://developers.google.com/custom-search/v1/overview
