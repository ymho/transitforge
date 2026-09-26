# Agent v2の同一loop内Intent更新

関連: #712、#631、ADR 0096

`update_intent`はApplication-localな条件差分の受付口であり、旅行・予約・決済のwriterではない。
意味理解とTool選択はStrands内のモデルが行う。旧Interpreter、別のSemanticモデル呼出し、V1 Prompt、repairは使用しない。
共通のbounded schema、quote/date/scope検証、AcceptedIntentDelta、reducer、CAS、receiptは#631の契約を再利用する。

```text
userMessage → Strands → 必要な場合だけupdate_intent
  → Application validation → A commit → Context Loader再読込
  → 同一invokeのread Tool → SDK structured output → 最新Intentで公開検証 → B commit
```

## 境界

- Controllerは認証済みConversation Applicationが組成する。モデルはowner、turn ID、revision、保存キーを選ばない。
- 1 invokeの更新試行は最大1回。入力拒否後も同じinvoke内で再試行しない。回答提出後は更新しない。
- 更新が不要な発話では呼ばない。`update_intent`と`SDK structured output`は外部Domain Tool budgetへ加算しない。
- 成功時に返すEffective IntentはA commit後にApplicationが読み戻したsnapshotである。readの事前条件と回答のEvidence/既知条件検証は同じ最新snapshotを参照する。
- quote/date/scopeなどの既知の入力不正は`intent_rejected`。保存、receipt送信、再読込の失敗は入力拒否に変換せず、そのturnの後続readと回答公開を止める。
- A commit済みの失敗は既存の`intent_accepted`からretryする。Controllerを再公開せず、revisionを増やさない。完了済みturnは保存結果をreplayする。
- V2 runtimeが組成されている場合、古いSemantic rollout optionが残っていてもV1 Interpreterは組成しない。

## 検証

V2 Acceptanceは`strands-intent-acceptance.test.ts`で、実Strands SDKとproduction-shapedな認証・DynamoDB fixture・Conversation保存経路を通す。
受入対象はA/read/B/history/replay、別turnの条件訂正、quote/date/scope拒否、不要な更新の不実行、1回制限、A commit後の再読込失敗からの回復である。
Providerの意味理解品質をsynthetic modelで証明したとは扱わない。V2 Live Evalは別の測定であり、V1 runtime testを互換oracleにしない。

次段階は旅行read Tool、カード、旅程、写真の利用シナリオから小さく追加する。提案・採用・保存のwriter公開は別段階とする。
