# Epic #631 会話意味論の現行監査と移行台帳

- 基準commit（Epic記載）: `84faf820`
- 実装開始時main: `4a720021bde15fce77afb9759868bfe1becbf686`
- 開始時open PR: なし
- 更新日: 2026-09-25
- 対象: #632–#648、#650–#654

この文書の「実装」はproduction compositionから到達するコード、「scripted」は合成model/Providerを使う自動test、「live」は実modelまたは実Browserでの観測を表す。scripted成功をlive成功へ昇格しない。

## 実入口から保存まで

| 段階 | production owner / symbol | 正本・境界 |
| --- | --- | --- |
| REST/SSE turn受付 | `conversation-route` → `createConversationTurnApplication` | Cognito principal、owner scope、turn idempotency |
| user messageとlease | `DynamoDbConversationTurnRepository.beginTurn` | Conversation CAS、request hash、固定`calendarDate` |
| 意味候補 | `createConversationIntentInterpreter` | 現在発言だけのbounded Structured Output。未信頼 |
| 受理候補生成 | `acceptedIntentDeltaFromInterpretation` | app生成ID/provenance/revision、quote、clock、target/value検証 |
| 意味適用 | `reduceConversationIntent` | pure atomic-group reducer、tombstone、idempotency |
| A: 意味受理保存 | `DynamoDbConversationTurnRepository.acceptIntent` | TURN receipt + WORKING v2を単一transactionで保存 |
| context再読込 | `createServerStateContextLoader` | owner-scoped Conversation/Profile/Trip/Working State |
| 判断・Tool・回答 | `createStatefulServerAgent` → `MultiStepAgentRuntime` | native Tool、Evidence、bounded loop、answer/ask v4 |
| B: 回答保存 | `completeTurn` | assistant message、presentation/Evidence receipt、最新semantic merge |
| history/SSE | Conversation history / stream application | 公開artifactのみ。意味receiptの公開projectionは#644/#646 |

BrowserからWorking State、Profile、Trip本文、owner、revisionを受け取らない。TripとTripRequestは採用済み状態、Proposalは未採用変更案、Conversation semantic overlayは今回の会話で受理した疎な希望差分である。

## 能力・重複・移行台帳

| 能力 | 既存実装 | 2026-09-25の差分 / Issue | production到達・test | 移行・撤去対象 |
| --- | --- | --- | --- | --- |
| task/decision contract | `AgentTaskContext`、`SemanticDecision`、answer/ask v4 | 小さいutterance deltaを追加 #633/#637 | Server Runtime tests | legacy Decision Summaryはlegacy provider限定 |
| 会話継続 | Working State v1、presentation/Evidence/outcome | v2 semantic overlay/receipt #639 | Dynamo adapter-shaped tests | v1 read、v2 write、unknown拒否 |
| 日付 | `uiContext.calendarDate`、Trip temporal | app-owned relative-date解決 #635 | 2026-09-25→26 fixture | recovery regexを#645/#653で撤去 |
| 条件強度 | Trip requirement/assumptionの部分表現 | required/preferred/acceptable/avoid/forbidden #633 | pure parser/reducer tests | Prompt内の暗黙強度推測 |
| 訂正・撤回 | Trip Proposal/CAS、request validator | replace/retract/tombstone/relax/narrow #638 | pure reducer + failure tests | history要約からの復活を禁止 |
| scope/reference | PresentationReceipt、Trip/day/segment IDs | frameをfact/tombstone/reducerへ貫通。ordinalは最新のowner-scoped PresentationReceiptからApplication解決 #636 | production turn + stale/range負例 | 本文の「2番目」再parse |
| Effective Intent | server context compiler、Trip/Profile snapshot | base+overlay+retractをauthority別にpure投影 #640 | Server Runtime context + pure tests | raw semantic overlayのmodel重複送信を撤去 |
| Profile preferences | UserProfile v2、TripRequest source=profile、Agent profile snapshot | 常設の弱い既定値をEffective Intentへ直接解決 #634/#640/#658/#659 | Profile一項目比較、scope/撤回、Server context | 人数・子年代・予算感・移動上限・noveltyをAI/UIから除外。保存済み値は保持 |
| action policy | Tool schema、SemanticDecision、progress guard | Application-authored requirementとeffective revision連携 #641 | Runtime Tool前検証 + allow/reject対テスト | LLM自己申告だけの不足判定を不採用 |
| invalidation/replan | Evidence applicability、PlanVariant、CAS | target別meaning dependency連携 #642 | Server initial Evidence + Tool Evidence tests | legacy無依存Evidenceだけ安全側で失効。全消去・無条件再検索を撤去 |
| proposal/branch | Request Proposal、PlanVariant、Trip CAS | conversation delta接続 #643 | 未実装 | overlayからの直接Trip writeは禁止 |
| response/UI | typed presentation、history/SSE、既存cards | public meaning receipt #644/#646 | 未実装 | UI本文推測 |
| degraded path | verified Evidence summary、turn retry | A/B故障区別 #645 | A後failure/retry testあり | 独自自然言語補完を撤去 |
| eval/trace/security | Epic #537/#557/#558基盤 | #647/#648/#650/#651 | 初期diagnostic hookあり | raw state/CoTを追加しない |
| budget/rollout | bounded Runtime、feature env | default-off gate/read-old-write-new #652/#653 | Terraform/schema tests | 専用二重推論は暫定 |

既存#537のAgent、Evidence、Variant、Context、evaluationを再利用し、新しい汎用Planner、event store、Trip複製を作らない。#559/#589のUIと#561の評価成果は置換せず、意味receiptと追加scenarioを接続する。

## 失敗分類

| phase | 代表症状 | 判定元 | 修正owner |
| --- | --- | --- | --- |
| interpretation | 許容を必須、質問をassertionとして抽出 | interpretation outcome / gold expected | #633/#637/#648 |
| reference-resolution | 「2番目」が古いpresentation/別Tripを指す | presentation + owner/revision resolver | #636 |
| authority | Profile推測がuser-confirmed、会話がTripを直接変更 | source/authority policy | #634/#651 |
| reduction | 追加が置換、groupの一部だけ適用 | reducer receipt | #638 |
| persistence | 回答失敗で消失、再送で二重適用 | A receipt / intent revision | #639 |
| context | 履歴切詰めで古い条件復活・消失 | effective intent hash/revision | #640 |
| action-policy | 既知値を再質問、条件違反Tool入力 | requirement policy reason | #641 |
| evidence | 古い日付の結果を新revisionで採用 | applicability/dependency ref | #642 |
| response | 本文と受理state/カードが矛盾 | public receipt + presentation | #644 |
| UI | reload/別タブでcurrent/stale表示が不一致 | server receipt/revision | #646 |
| evaluator | 最終成功が途中失敗を隠す、expected混入 | per-turn observation / runner manifest | #647/#648 |

原因を一括して「AI品質」としない。schema validでもinterpretation、authority、scopeが誤れば失敗である。

## 独立した自然言語解釈の撤去台帳

| 現行箇所 | 種別 | 現行目的 | 後継契約 | 削除条件 / 保持条件 |
| --- | --- | --- | --- | --- |
| `agent-runtime.ts::verifiedPlanningSummary` | regex (`明日`等) | Provider failure時の日付継続 | accepted semantic overlay + degraded presenter #645 | 明日/明後日/月末/言い換えの2turn回帰後に語句抽出を削除。検証済みEvidence summaryは保持 |
| `planning-draft-recovery.ts::recoverPlanningDraft` | recovery/default | draft条件補完 | Effective Intent + receipt #640/#645 | 同等failure fixture後に自然言語抽出を削除。schema/date validationは保持 |
| system/model Prompt | 自由文指示 | 強度、質問、Tool判断 | semantic schema + action requirement policy #633/#641 | model表現指示は残せるがstate確定の第二正本にしない |
| legacy Decision Summary parser | legacy text parser | provider移行 | answer/ask v4 + native Tool | legacy provider期限中のみ。strict出力へfallback適用しない |
| Conversation history/summary | implicit recovery | 過去条件想起 | Working semantic overlay #640 | 表示文脈として保持、確定条件抽出には使わない |
| UI proposal/card inference | UI推測 | pending/current表示 | public semantic/proposal receipt #644/#646 | receipt接続後に自然言語・カード存在による推測を削除 |

UUID、owner、revision、schema、暦日、文字数/bytes、Evidence reference、CAS、認可のvalidatorは撤去対象ではない。新経路が再現ケースと言い換えケースを通る前に旧縮退を削除しない。

## ガード契約と置換状況

phaseは表示・予算を選ぶ補助情報であり、質問・Evidence・行程・写真を一律に要求する権限ではない。ガードはApplicationが受理した今回の意味操作、モデルの型付きaction/presentation、実際のEvidenceを組み合わせて判定する。RuntimeがAPI都合で`user` roleに入れるrepair/guard文は命令であって利用者発言ではなく、意味Interpreterへ渡すtrusted utteranceはturn受付時の`userRequest`だけである。

| guard / code | 守る条件・適用対象 | 正当に通す例 | 拒否する例 | 置換状況 |
| --- | --- | --- | --- | --- |
| `shouldRequirePlanningProgress` | 同じ意味状態のままoptional質問だけを連続させず、受理済み項目を聞き直さない | 未回答項目の初回型付き確認、現在turnの訂正受理後の別質問、安全・authorization、候補提示後の選択 | 初回でもEffective Intentに回答済みの項目、または直前も`ask_only`で意味差分も例外理由もない質問票 | phase一律抑止を`previousOutcome + currentIntentChange + typed requirement + EffectiveIntent`へ置換。allow/reject対テスト済み |
| `hasPlanningQuestionnaire` | strict移行前のlegacy proseが`answer`を偽装して質問票を出すのを限定的に防ぐ | `application_strict`/`provider_strict`の一般説明、型付き`ask_user` | `legacy_text`またはmode不明で複数optional項目を列挙 | strict出力へのregex再解釈を停止。legacy期限後に削除 #653 |
| `acceptsAgentTurn` | 保存済み直前turnとの組合せで無進展の連続質問を防ぐ | Application検証済みの現在turn意味変更、外部化可能な安全/認可例外 | 同一stateで例外なしの`ask_only → ask_only` | `currentIntentChange`をServer contextから渡す。modelはこのフラグを自己申告できない |
| `planning_evidence_required` | 外部事実を確認済みとして主張するanswer/planだけをEvidenceへ束縛 | 条件追加・訂正・撤回のack、一般質問、未確認と明示した案内 | `travel-plan`、Evidence ID、`evidence_sufficient`を宣言したのにEvidenceなし | phase+answer一律要求をclaim起点へ置換。根拠なし候補拒否テストを維持 |
| `planning_plan_required` | 明示的に旅行案を作るactionではtyped planを要求する（応答contract側） | 条件変更のack、確認、source説明、一般質問 | plan contractを選んだturnの壊れたpresentation | phase+sourceだけで全回答へ行程を強制するRuntime guardを撤去。typed output contract/validatorへ集約 |
| `place_photo_required` | `travel-plan`を写真付きで構成可能なfinalizationだけをbest-effort補完 | 条件変更・確認・一般質問・source説明、Tool予算終了時のsource-bound plan | travel-plan宣言、sourceあり、photoなし、かつphoto Tool実行可能 | phase一律要求を`declaredPresentation.kind=travel-plan`へ限定 |
| quote/provenance acceptance | 実際の現在user turnに存在する引用だけを`user_turn`へ昇格 | exact substringをApplicationが検証しID/revision/sourceを付与 | modelの`source=user`自己申告、history、repair/guard文だけにある語句 | Interpreter schemaにsourceを持たせず、`acceptedIntentDeltaFromInterpretation`がcurrent `userRequest`だけで検証 |
| Tool重複/cache/retry | readは依存stateが同じなら再利用し、proposal/writeは実行内で冪等にする | 別Tool成功で前提が変化したread再評価。署名はrequest/Working/intent revisionを含む | 同じ依存版の同一read、同一proposal/write、無制限retry | Application登録のeffectと依存版を署名へ追加。異なるTool成功後だけ同一readを1回再評価し、proposalは常に重複抑止。allow/reject対テスト済み |
| Tool intent requirement | Tool固有の必須入力・精度・現在値一致をApplication由来のEffective Intentで検証 | 受理済み京都・2026-10-01を同値で検索 | 未定/非開示値の補完、日付訂正後の旧日付、必須値欠落 | descriptorの`intentPolicy`をRuntime実行前に適用。modelは依存targetを緩和できない |
| Evidence meaning dependency | Evidenceを取得時の意味targetへ束縛し、局所訂正だけ失効 | 目的地訂正後も日付だけに依存するEvidenceを保持 | 目的地依存Evidence、意味依存を記録しない旧Evidence | Tool成功時にintent revision/fingerprint/targetsをApplication付与。Server再利用前にfilter |
| Profile resolution | 保存Request、Profile、actual会話差分を属性・scopeごとに解決し、Profileはreference-onlyに保つ | 食事の追加と既存の自然/歴史を併用、2日目だけpace変更、許諾済みメモ全文 | 出発地を未定へ戻した後のProfile復活、非同意メモ、普段人数を今回人数へ昇格 | `compileEffectiveIntent`へUserProfile revisionを入力し、`travelProfile`も解決済みhintから導出。modelへraw Profileを並列送信しない |

認証、owner分離、Trip実在参照、予約保護、利用者confirmation、Evidence参照、CAS/turn冪等性、保持/削除保証は意味ガードの緩和対象に含めない。開発作業の包括承認も、製品利用者のTrip/Profile/予約変更への同意として扱わない。

## 最小fixtureと現時点の判定

| 系統 | scripted layer | 現時点 |
| --- | --- | --- |
| 目的地→日付 | production turn app + Dynamo-shaped adapter | 受理・継続。full Server同一turn入力も確認 |
| 許容≠必須 | parser/reducer + turn app | `acceptable`を保持 |
| 訂正・未定へ戻す | reducer + turn app | replace/retract+tombstoneを保持 |
| 候補2番目 | bounded interpreter outcome | **未実装**。安全にunsupported/no mutation。#636でreceipt resolverへ接続 |
| 元案を保持 | reducer + turn app | `add_alternative`で既存fact保持。PlanVariant化は#643 |
| Provider failure後の再送 | turn app + Dynamo-shaped adapter | A前は再解釈、A後はreceipt replayし状態保持 |

## Wave 1 実行記録

- branch: `feat/631-wave1-semantic-acceptance`
- 実装開始SHA: `4a720021bde15fce77afb9759868bfe1becbf686`
- 自動test: `npm test`（frontend 1718、agent-api/runtime 1095、stream contract 5、全件成功）、`npm run workspace:check`、`npm run architecture:check`、`npm run build`（全て成功）。`npm run eval:agent:smoke`は12/12成功。
- 実model、実Provider、実Browser、deployment: この表の作成時点では未実施。scripted fixtureの成功と区別する。

## Wave 2 実行記録

- base: PR #655 merge `4cd61282cefedea0efd18e8ebc131e878575eb45`
- frameはfact/tombstone/reducer receiptのidentityに含め、hypothetical set/retractがactualを変更しない対テストを追加した。
- 発言行為を操作と分離し、Application受理receiptからRuntimeへ投影する。repair/guard文はInterpreterのtrusted utteranceへ入れない。
- `EffectiveIntent`は保存Request、Profile hint、actual/hypothetical会話fact、retraction、suppressed base refを同じrevision/fingerprintで導出する。decision modelへraw semantic overlayを重複送信しない。
- ordinalはPresentationReceiptからApplicationがcandidate refへ解決し、model自己申告のresolved ref、範囲外ordinal、別Trip targetを拒否する。
- 相対日、相対weekday、月offsetをtrusted calendarで解決し、anchor/rule versionを保持する。月精度を日へ丸めず、quoteにないexact dateを拒否する。
- 自動test: `npm test`（frontend 1718、agent-api/runtime 1103、stream contract 5、全件成功）、`npm run workspace:check`、`npm run architecture:check`、`npm run build`（全て成功）。`npm run eval:agent:smoke`は12/12成功。
- 実model、実Provider、実Browser、deployment: 未実施。scripted成功と区別する。

## Wave 3 実行記録

- base: PR #656 merge `000385468e4ee20f32b439306dae49d2b71dade1`
- Tool descriptorへApplication-ownedの意味依存target、必須/任意、必要精度、現在値一致contractを追加した。RuntimeはTool実行前に同じEffective Intentへ照合し、未定・欠落・訂正前入力を非retryableで拒否する。
- Tool Evidenceへ取得時のintent revision/fingerprint/targetを付与し、次turnの意味差分と交差するEvidenceだけを失効する。旧Evidenceは意味変更時だけ安全側で失効する。
- semantic feature gateがまだreceiptを生成していない空projectionは移行互換として旧経路を許可する。gate有効化後はcurrent turn receiptで検証する。
- scripted test/build結果、PR/CI、実model、deploymentはWave完了時に追記する。

## Profile設定統合（#658/#659）

- Profile永続schema v2は維持し、非表示にした普段人数・同行者・子年代・予算感・移動上限・noveltyを削除しない。AI projectionではADR 0086の`ignoredProfileSettings`として値を送らない。
- 設定UIは5カテゴリの独立開閉とdraft由来summaryへ変更し、保存button/sticky bar/discard/通常の離脱blockを撤去した。
- text/textareaはIME確定後400ms、select/checkbox/choiceは即時autosaveする。ControllerがCAS revisionを使って直列化・coalesceし、失敗時は入力を保持する。
- ナビ、accessible name、page headingを「設定」に統一した。DOM/Controller scripted testとbuildを実施し、実Browser visual/IMEはPR記録で別に扱う。
