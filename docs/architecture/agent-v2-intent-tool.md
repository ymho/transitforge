# V2の条件更新Tool

関連: #716 / #724。前提: #722 / ADR 0097のStrands標準構造化出力。

## 置換対象

#712の `update_intent` / `UtteranceInterpretation` / `semanticInterpretationOutputContract` / V2内の旧decoder / 1 invoke1試行制限は、このbranchでは使用しない。純粋なAcceptedIntentDeltaとreducer、Effective Intent、owner、A/B commit、CAS、Evidence/currentnessは再利用する。

標準Strands `tool()`にZodのstrict schemaを渡し、以下の独立した業務操作を公開する。

- `set_destination(place, quote)` / `set_origin(place, quote)`: 指定・訂正。
- `clear_destination(quote)` / `clear_origin(quote)`: 明示された撤回。

未設定やnullを設定操作で受け付けない。撤回は別の明確な業務操作であり、モデルがsetterのnullを変更なしと誤解して条件を消す経路を作らない。検証フィードバックと逐次実行はSDK標準へ任せ、独自のAgent phase、ToolChoice強制、Proxy、入力補修を追加しない。

## Applicationの契約

最初のscopeはConversationの行き先・出発地だけ。Trip/Profile/予約/決済は更新しない。型と許可項目はZod、根拠が今回の発言に含まれることと地名がその根拠に含まれることはApplicationが確認する。仮定や比較を変更と扱うかはモデルの意味理解を実モデル試験で評価する。部分文字列検証だけで意味理解を証明したとは扱わない。

1操作の正体は、このuser turnにおける1条件の最終意思決定。Applicationが `condition:<turnId>:<target>` を識別子にする。同じ条件/同じ値の再送は元receiptを返し、同じslot/別値は競合とする。異なる値へさらに変更したい場合は次の利用者turnで行う。モデルのtoolUseId、呼出順、再試行attemptに依存しない。

独立した条件は同一turnで複数確定できる。一方、期間の始終など一体で整合性を守る必要がある条件は、将来1つの業務操作として追加する。この実装を一般的な任意patch engineへ拡張しない。

## 永続化と回復

既存TURN recordにversion 1のoperation journalを追加する。個々のreceiptとWorking overlayを既存DynamoDB transaction/CASで原子的に保存する。別テーブル・別Intent正本は作らない。

- 最初の更新が成功し次が失敗しても、成功した操作は保持する。
- 同じ操作の再送で二重適用しない。元receiptを返した後もContext Loaderは現在の正本を読み、古いsnapshotへ戻さない。
- 保存結果が不明な失敗では後続read/公開を閉じる。新しい試行はjournalから再開する。
- 完了済みturnは保存済みB結果をreplayする。未完了の古いturnは後続turnの条件を上書きしたり、新しい回答を保存したりできない。
- journalがない旧intentReceipt付きturnは旧形式として再生するが、新しい複数更新のturnとして再解釈しない。
- 既存の単数public semanticReceiptは操作receipt群から作る表示用summaryであって、新たなmutationや正本ではない。

## 進捗・検証

2026-09-26、PR #724はDraft。決定論的な受入は173テスト成功。実モデルの最小条件試験はNova 2 Liteで3/3成功したが、旅行検索/カードを含むConversation試験は2/3で、一般的な利用成立は未完了。#716をcloseせず、実モデルの不合格を通常CI greenで代用しない。

詳細な結果は `agent-v2-condition-verification.md`。プロフィール縮小は独立した#725へ分離する。
