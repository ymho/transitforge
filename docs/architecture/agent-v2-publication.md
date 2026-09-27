# Agent v2の構造化出力と公開境界

関連: #716、#631、ADR 0096。対象SDK: @strands-agents/sdk 1.18.0。

```text
userMessage → Strands Agent
  → 必要ならupdate_intent / A commit
  → read Tool / Evidence
  → SDK structuredOutputSchemaで構文検証・終了
  → result.structuredOutput.reply
  → Application admission / Evidence・claim検証
  → B commit → SSE / history / replay
```

## 標準機能に委ねること

Zodのstrictなdiscriminated unionを構文の唯一の定義にする。SDKへ渡すJSON SchemaとApplicationのparseは同じZod schemaから生成する。SDK Toolの最上位はobjectで、variantはreplyの中へ置く。独自のflat schema、手書きvariant parser、submit_reply Tool、提出済み状態、Model Proxy、toolChoice切替は使わない。

SDKは有効なstructured outputを取得した時点で終了する。回答取得後に終了用のmodel callを追加しない。通常のlastMessage、toString、reasoning、SDKのplain textは公開も保存もしない。

## 検証の責務

Schemaの通過は事実の正しさや保存の権限を証明しない。Evidence参照の存在・一意性・currentness、Effective Intentのrevision/fingerprint、操作receipt、owner、CASはApplication側に残す。モデルがschemaに沿った架空IDを返しても公開しない。

## SDKの再試行を隠さない

SDK 1.18.0は不正な構造化出力にvalidation feedbackを返す。plain textで終了しようとした場合は、SDKが構造化出力Toolを一度指定して再度modelへ要求し、それでも拒否すればStructuredOutputErrorとなる。これは追加の自前repairではなく、選択したSDKの標準動作である。

すべて同一invokeのturn/token/deadline上限内で行い、外側でinvokeを再実行しない。不正出力の繰返し、指定後の拒否、token上限、通信失敗を完了と扱わない。Domain Tool budgetにはSDKの出力Toolを数えない。

## 合否の区別

- 決定論的Acceptance: actual SDK + scripted model。構文拒否、不要な末尾呼出しなし、上限、A/B/history/replay、owner・Evidence拒否。
- `AGENT_V2_LIVE=true npm run test:agent:v2:conversation-live`: actual Bedrock + fixed travel Provider + state fixture。最大4 turns × 6 model cycles、各turnは60秒、writeなし。
- 実Provider/実ブラウザ: 別の確認。上記の成功で代用しない。

#721のV2専用Frontend表示分離は別作業。今回の公開snapshotの保存契約は維持する。

## 対話の自由文と受理済み条件（#729 / #736）

`conversation`、`clarification`、`uncertainty`に任意の`commentary`（1〜1200文字）を追加する。
確認、補足、仮定を置いた検討、未確認事項をモデル自身の自然文で説明できる。既存の短い形式も
受理するが、固定文への置換を対話の標準としない。SDKのstructured outputだけを公開し、
lastMessageの抜取り・本文再解析・outer repair・新しいAgent loopは追加しない。

会話文はEvidenceや実行記録ではない。外部情報の`answer`は引き続き実在するEvidence参照が必須で、
`operation_result`はApplicationの同一実行receiptに照合する。自由文を持つだけで検証済みClaim、
receipt、Trip/Profile writer、予約・決済の権限を得ることはない。
ただし自然文の意味がすべて正しいことをスキーマだけで証明できるわけではない。未確認の料金等を
自由文で確定する誤りはモデルの品質試験で評価し、発話regexによる擬似的な完全保証は作らない。

条件Controllerが本当に返した受理記録と最新EffectiveIntentをoperation単位で照合し、
Applicationが「今回の相談条件（反映済み）」として変更内容を表示する。scopeは日・区間番号へ
読み取り専用で投影し、raw ID、来歴quote、年齢・料金資格の推測は表示しない。stale scopeは
要確認とする。受理記録なし、仮定、拒否された操作、既に後続訂正で失効した旧receiptからは
反映済み表示を作らない。最終テキストは既存の16KB上限とB commitを通り、SSE/history/replayで共通となる。
これは条件の受理であって、Tripへの保存や予約の成功表示ではない。

確認はtargetの存在だけでは一律に拒否しない。既知の行き先や同行者にも変更対象の確認があり得る。
commentaryを持つ文脈付き質問はモデルが判断し、未確定の対象は更新しない。一方、別の確定済み
条件は同じ発言で更新できる。「質問が含まれるturnは全writer禁止」という規則は設けない。

### 再現した停止原因

修正前のNova 2 Lite run `36295974660`（`33f7ce1`）では、非永続の参加仮定の後、
`answer`の`reply.references`が空または欠落し、SDKのスキーマ検証で5回拒否された。
終了は`limitTurns`、modelCalls=6、outputTokens=668であり、出力token上限の枯渇ではなかった。
`AfterToolCallEvent`から固定allowlistのkind、検証コード、フィールド名だけを観測した。
本文・内部思考・例外メッセージは記録せず、hookで入力修正や再試行は行わない。
同じ仮定発言を`strands-dialogue-output-live.test.ts`で継続して検証する。

### 出力上限と評価

Engineの`maxOutputTokens`はモデル1回、`maxInvocationOutputTokens`はSDK invocation全体の
累積出力上限とする。`input.limits.maxOutputTokens`は後者を上書きする。productionは両方4096を
明示し、今回の変更で本番の予算を引き上げない。既存liveも従来の累積値を明示する。
実SDKの累積上限テストを維持し、per-model値を黙って累積値として使わないことを別途確認する。

`strands-dialogue-history.fixture.ts`はdeterministic/live共通の認証済みConversation組成である。
履歴はテストが捏造せず、通常のowner-scoped loaderから取得する。出発地更新と同行者の保留、
「10代の方です」「逆でした」、what-if、撤回、B replayと履歴の一致を検証する。
実モデルは`npm run test:agent:v2:dialogue-live`（7ターン、各最大6呼出し、60秒）で実行する。
通常のActionsは課金liveを行わない。手動Strands v2 Liveの`dialogue-history`で1/3反復を選べる。

合否の正本は保存値、操作ID、receipt、revision、無関係な条件と未確定対象の維持、返答の完了である。
拒否・同一操作の再送を含むwriter callback数は二重commitと区別して計測する。what-ifでは従来通り
writer callback=0を必須とする。失敗ケースの発言や期待保存値を通すために変更しない。
