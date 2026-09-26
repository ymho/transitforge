# ADR 0097: V2の出力構文と終端処理を標準ライブラリへ統一する

- ステータス: Accepted
- 日付: 2026-09-26
- 関連: ADR 0096、#716、#722

## 問題

独自submit_reply、受理状態、Model Proxy、ToolChoiceの切替を追加しても、実モデルの応答成立を確認できていなかった。提示JSON Schemaと手書きparserの構文も一致していなかった。制御の追加ではなく所有範囲を減らす。

## 判断

Strands SDK 1.18.0のstructuredOutputSchema / structuredOutputで構文検証と終了処理を行う。Zod 4のstrict object/discriminated unionを、JSON Schema、型推論、Application入力parserの単一正本にする。SDKの出力Toolはobject envelopeを受け、replyに判別unionを含む。

独自submit_reply Tool、AgentV2ReplySubmission、Model Proxy、ToolChoice切替、手書きvariant parserを削除する。構造化結果を受け取った後の終了専用model callもなくす。

ZodはI/Oを持たない実行環境非依存のschema/validationライブラリであり、Providerの実装ではない。そのためmodules/agent/runtimeの共有契約ではZodを直接利用できる。アーキテクチャ検証にパッケージとして明示し、特定ファイルを迂回するmigration exceptionは作らない。AWS SDK、Strands、HTTP、Frontend/Backendへの依存禁止は維持する。既にlockfileに存在するZodを直接依存へ宣言するだけで、別schema frameworkを並立させない。

## 残すもの

ApplicationのEvidence/claim/currentness、実操作receipt、owner、A/B commit、CAS、正本、replayはSDKの出力型では代替できない。参照の重複や未確認の値は公開境界で拒否する。SDKの構文合格を操作権限・事実の保証と扱わない。

## 標準動作と制限

SDKの構造化出力検証にはvalidation feedbackがある。またplain textで終了した場合は、SDKが出力Toolを一度指定して再要求する。これらを隠さず、同一invokeのturn/token/deadline上限を適用する。外側のrepair、再invoke、モデル自由文の公開fallbackは追加しない。

## 検証

actual SDK + scripted modelの契約テストと、actual Bedrock + fixed travel Providerの会話テストを分ける。後者はProduction-shaped Conversationを通し、挨拶・条件受理・訂正・カード・未対応保存・履歴/replayを検証する。実Providerや実ブラウザの成功とは区別する。個別失敗が残れば、schema / Tool情報 / Application admission / モデル適性のどの契約かを調べ、発話別例外を加えない。
