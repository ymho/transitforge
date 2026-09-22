# ADR 0074: Agent task・意味判断・会話Working Stateを型付き契約にする

- ステータス: Accepted
- 日付: 2026-09-22
- 関連: #538、#539、#551、#552、ADR 0032 / 0044 / 0046 / 0068

## 背景

旧経路は`tripContext.planningStage`等の表示用投影と`<decision_summary>`のtext parsingへ判断を依存し、候補番号や前回の提示結果を履歴本文から復元していた。評価fixtureもexpectedの目的地・日付をRuntime contextへ注入していたため、本番で成立しない能力を合格にできた。

## 決定

Provider非依存の`AgentTaskContext`、discriminated unionの`SemanticDecision`、field/action/target/resolutionを持つ`MissingRequirement`を`modules/agent/runtime`へ置く。Applicationはschema validだけでなく、選択actionとnative Tool call、公開Tool、許可target、質問を必要とする不足事項の整合を検証する。

会話継続にはversioned `ConversationWorkingState`を使う。これはowner+conversation scopeで、提示ID/version/ordinalからcandidate refへの写像、前回の公開outcome、pending refだけを保存する。assistant message、turn receipt、Working Stateは同一DynamoDB transactionで更新する。Trip/Profileや候補内容を複製せず、Trip参照にはrevisionを持てる。

同一turnの再送は最初に受けた`calendarDate`をrequest hashへ含め、異なる基準日での再利用をconflictにする。評価datasetはinputとexpectedを物理分離し、production compositionへexpectedを渡さない。

## 互換性と移行

PR1では既存モデルとの移行のため`AgentDecisionSummary`から`SemanticDecision`への一方向変換を残す。native Tool callでsummary自体がない旧応答もPR2まで許容するが、summaryがある場合のaction/tool不一致は拒否する。`planningStage`を新判断の入力にはしない。

PR2でBedrock Structured Outputsを主経路にし、旧text parserをfallbackへ降格する。Working Stateがない既存会話は空状態から開始でき、既存Trip/Conversationレコードのmigrationは不要である。

## 影響

- 「2番目」は表示時に確定した参照を解決でき、Markdownの再parseを必要としない。
- 質問だけの応答は、外部化可能な利用者判断・authorization等がない限り進展を伴う修正対象になる。
- Working State更新はturn完了と不可分で、partial streamやretryから第二の編集正本を作らない。
- 生会話や私的推論はWorking Stateへ保存しない。
- datasetの期待値をRuntimeへ混入させた評価、case IDによる特例、Provider画像URL数を表示写真数とするproxyを廃止する。
