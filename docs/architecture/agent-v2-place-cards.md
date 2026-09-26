# Agent v2の場所候補カード

関連: #714 / #681 / ADR 0096

## 最小の公開契約

代表readは既存の`search_place_media`。写真の取得成功を前提にせず、`externalTravelEvidence`が作る解決済み場所の`place_description`だけを候補カードへ使う。
モデルは`submit_reply`の`kind=candidates`でEvidence IDの順序と根拠付きcommentaryを選ぶ。場所名、説明、出典URLはApplicationがEvidenceから投影し、モデルのカードpayloadを受け取らない。

`PublicPlacePresentation`はConversationへ保存する表示snapshotであり、Trip、旅程、採用候補セット、第二の永続候補ストアではない。写真、価格、空室、営業状態、保存・予約の結果はこの型へ入れない。

## 防御と未対応

- 場所のsubject、source URLとEvidence reference、currentness、最新Effective Intentのrevision/fingerprintを公開前に検証する。
- 検索snippet、未解決subject、ページ全文を場所候補へ昇格しない。説明は元資料の400文字以内の抜粋とし、出典へ辿れる。
- 候補数や旅先ごとの固定応答は設けない。8件は公開payloadの上限であり、必ずその件数を作るという指示ではない。
- 候補がない場合は空の架空カードを埋めず、既存の確認・不確実性回答を選ぶ。
- replayは保存時点の表示snapshotを返す。履歴のカードを、新しい条件に対する最新検索結果へ自動昇格しない。
- writer、旅程表示、写真表示は後続sliceであり、本契約はそれらを許可しない。

実Strands＋scripted modelの契約検証と、実Bedrockの意味理解・推薦品質は別に記録する。実環境の一般エラー表示だけから失敗境界を確定しない。
