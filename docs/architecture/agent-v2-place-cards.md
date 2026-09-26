# Agent v2の場所候補カード

関連: #714 / #681 / ADR 0096

## 最小の公開契約

代表readは既存の`search_place_media`。写真の取得成功を前提にせず、`externalTravelEvidence`が作る解決済み場所の`place_description`だけを候補カードへ使う。
モデルは`submit_reply`の`kind=candidates`でEvidence IDの順序と根拠付きcommentaryを選ぶ。場所名、説明、出典URLはApplicationがEvidenceから投影し、モデルのカードpayloadを受け取らない。

`PublicPlacePresentation`はConversationへ保存する表示snapshotであり、Trip、旅程、採用候補セット、第二の永続候補ストアではない。写真、価格、空室、営業状態、保存・予約の結果はこの型へ入れない。

```text
Strands → 必要ならupdate_intent / A commit
  → 既存旅行read → Evidence / candidateReferences
  → submit_reply(candidates) → Applicationの参照・claim検証
  → B commit → final SSE → 共通UI投影
                ↘ owner-scoped履歴 / replay → 同じUI投影
```

## 防御と未対応

- 場所のsubject、source URLとEvidence reference、currentness、最新Effective Intentのrevision/fingerprintを公開前に検証する。
- V2 readは個別の入力フィールド制約がない場合も呼出時のIntent snapshotに束縛する。後で条件が変わったreadを、新条件の結果として公開しない。任意の検索語や推薦理由の意味的な適切さまで、このrevision検証で保証したとは扱わない。
- 検索snippet、未解決subject、ページ全文を場所候補へ昇格しない。説明は元資料の400文字以内の抜粋とし、出典へ辿れる。
- 候補数や旅先ごとの固定応答は設けない。8件は公開payloadの上限であり、必ずその件数を作るという指示ではない。
- 候補がない場合は空の架空カードを埋めず、既存の確認・不確実性回答を選ぶ。
- replayは保存時点の表示snapshotを返す。履歴のカードを、新しい条件に対する最新検索結果へ自動昇格しない。
- writer、旅程表示、写真表示、候補番号からの採用操作は後続sliceであり、本契約はそれらを許可しない。

## 検証

`npm run test:agent:v2`に、候補公開の純粋テスト、実Strandsと既存productionServerToolsを通すConversation縦断、DynamoDBの完了再送競合、SSE/HTTP履歴の入力検証、live/history共通UI表示を含める。Providerはfixtureであり、実APIの到達性・検索品質は別の確認対象である。
通信断はB commit後のfinal書込みを失敗させ、同じturnのretryでカードを失わず旅行readを繰り返さないことを検証する。

PRではV2 Acceptance、Smoke、全体CIを確認する。実Strands＋scripted modelの契約検証と、実Bedrockの意味理解・推薦品質、実ブラウザの視覚確認は別に記録する。実環境の一般エラー表示だけから失敗境界を確定しない。


## V2終端プロトコル

Promptだけに`submit_reply`遵守を委ねない。reply未提出の各model requestはStrands/Bedrockの`toolChoice=any`で最低1つのTool callを要求し、`submit_reply`が受理された後だけ`toolChoice=auto`へ戻す。これによりread後のfree-text `endTurn`を公開候補へ変換したりrepair loopで再解釈したりせず、typed publication boundaryをモデル呼出し層で維持する。
