# ADR 0088: Application受理済み意味receiptだけを公開する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#639、#644、#645、#646、ADR 0082

## 背景

意味差分は回答生成前のA transactionでWorking Stateへ保存されるが、Browserへはモデル本文とpresentationだけが返っていた。このままでは「希望として受理」と「Tripへ保存」「予約完了」を区別できず、回答失敗後のretryやreloadでも画面表示が一致しない。内部receiptをそのまま公開すると、発言引用、条件値、stable resource ID、fact参照まで不要に漏れる。

## 決定

Applicationが`IntentApplicationReceipt`を`PublicSemanticReceipt v1`へ投影する。公開fieldはintent revision、speech act、全体outcome、操作/group参照、action、target、scopeの種別、frame、statusに限定する。値、quote、scope ID、before/after fact、rejection reason、Profile、Evidence本文、Tool入出力、Traceは含めず、全境界でexact schemaを検証する。

A transactionがcommitした後だけSSEの`intent_accepted`を送る。このイベントはterminalではなく、回答処理は続く。finalにも同じreceiptを付け、turn resultとassistant historyへ永続化する。A後にProviderや接続が失敗しても、同一turn retryは保存済み内部receiptから同じ公開receiptを再構成する。

Frontendは中間receiptをstrict parseし、final/historyは共通の`projectAssistantTurn`を通す。状態表示はtyped targetから生成し、モデル本文やカードの文言を再解析しない。「今回の希望に反映」はTrip/Profile/予約の保存を意味しないため、保存済みという表示には別のcommit receiptを必要とする。

## 結果

- 新着、retry final、reload historyの意味状態表示が同一になる。
- モデルが`source=user`や保存完了を自己申告して状態を作れない。
- 内部state全体をBrowserへ送らず、部分受理を明示できる。
- 本文の強度・保存状態との忠実性評価、Proposalのcommit/stale receiptは後続の#643/#647/#648で追加する。
