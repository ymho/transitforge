# ADR 0074: Agent task・意味判断・会話Working Stateを型付き契約にする

- ステータス: Accepted
- 日付: 2026-09-22
- 関連: #538、#539、#551、#552、ADR 0032 / 0044 / 0046 / 0068

## 背景

旧経路は`tripContext.planningStage`等の表示用投影と`<decision_summary>`のtext parsingへ判断を依存し、候補番号や前回の提示結果を履歴本文から復元していた。評価fixtureもexpectedの目的地・日付をRuntime contextへ注入していたため、本番で成立しない能力を合格にできた。

## 決定

Provider非依存の`AgentTaskContext`、discriminated unionの`SemanticDecision`、field/action/target/resolutionを持つ`MissingRequirement`を`modules/agent/runtime`へ置く。Applicationはschema validだけでなく、選択actionとnative Tool call、公開Tool、許可target、質問を必要とする不足事項の整合を検証する。

会話継続にはversioned `ConversationWorkingState`を使う。これはowner+conversation scopeで、提示ID/version/ordinalからcandidate refへの写像、前回の公開outcome、pending refを保存する。Trip/Profileや候補内容を複製せず、Trip参照にはrevisionを持てる。

Epic #631 / ADR 0083で、会話の意味差分には回答公開と別のcommit pointを追加した。意味受理時はturn receiptとWorking Stateを同一DynamoDB transactionで更新し、回答失敗後も受理済み条件を保持する。回答公開時は従来どおりassistant message、公開receipt、Working Stateを同一transactionで更新する。会話overlayはTrip/Profileの変更権限を持たず、永続変更は既存Proposal・確認・CASを通る。

2026-09-24のRun #26で、最初のturnに公開した旅行先資料が宿泊・天気を調べる後続turnへ引き継がれず、`unbound_candidate_source`が反復した。このため、公開presentationまたは検証済みClaimが実際に参照したEvidenceのうち、`retention=bounded_excerpt`だけをWorking Stateへ最大24件・64KBで保持する。raw Tool output、未公開Evidence、`reference_only`、`prohibited`は保存しない。保存済みEvidenceは次turnのtrusted `initialEvidence`へ再注入し、モデル向けWorking State JSONには複製しない。これにより会話入力や質問順を固定せず、Applicationが出典の連続性を保証する。

同一turnの再送は最初に受けた`calendarDate`をrequest hashへ含め、異なる基準日での再利用をconflictにする。評価datasetはinputとexpectedを物理分離し、production compositionへexpectedを渡さない。

2026-09-24のRun #27ではEvidence継続の欠落は解消した一方、旅行案3件が`invalid_response_contract`となり、その直前の修正理由は`invalid_decision_summary`だった。目的・制約・行動・表示を一つの大きなmodel-authored envelopeへ重複させると、Applicationが既に観測できる判断メタデータの一項目でも最終回答全体が失敗する。そこでStructured Output v4は最終textを`answer | ask`へ縮小する。`answer`は`responseText`と必要な`evidenceIds`、`presentation`、`inTripAnswerPlan`だけ、`ask`は利用者判断またはauthorizationに限定した`missingRequirements`だけを持つ。Tool選択は引き続きnative toolUseであり、Applicationが検証済みenvelope/native callから`SemanticDecision`とTrace用summaryを導出する。旧Decision Summaryをモデルへ再出力させない。

利用者向けstreamにはApplicationが実際に遷移した粗い実行段階だけを出す。`understanding_request`、`checking_information`、`comparing_options`、`building_answer`、`validating_answer`はephemeralな公開状態であり、モデルの思考、仮説、prompt、Tool入出力、Evidence本文を含めず、Conversation Working Stateにも保存しない。AgentTaskContextと実行中のbounded Plan/Act状態がtask ledgerの正本であり、別の自由文scratchpadは作らない。

## 互換性と移行

PR1では既存モデルとの移行のため`AgentDecisionSummary`から`SemanticDecision`への一方向変換を残す。native Tool callでsummary自体がない旧応答もPR2まで許容するが、summaryがある場合のaction/tool不一致は拒否する。`planningStage`を新判断の入力にはしない。

PR2でBedrock Structured Outputsを主経路にし、旧text parserをfallbackへ降格する。v4移行後もlegacy text providerだけは既存parserを利用できるが、provider/application strict応答を旧Decision Summaryとして再解釈しない。Working Stateがない既存会話は空状態から開始でき、既存Trip/Conversationレコードのmigrationは不要である。

## 影響

- 「2番目」は表示時に確定した参照を解決でき、Markdownの再parseを必要としない。
- 質問だけの応答は、外部化可能な利用者判断・authorization等がない限り進展を伴う修正対象になる。
- Working State更新はturn完了と不可分で、partial streamやretryから第二の編集正本を作らない。
- 生会話や私的推論はWorking Stateへ保存しない。
- 進捗表示は内部Chain-of-Thoughtの要約ではなく、Applicationが観測した安全なphase名に限る。
- 公開済みEvidenceのbounded excerptは候補内容の第二正本ではなく、同じ公開候補を後続turnで検証するためのgrounding receiptである。
- datasetの期待値をRuntimeへ混入させた評価、case IDによる特例、Provider画像URL数を表示写真数とするproxyを廃止する。
