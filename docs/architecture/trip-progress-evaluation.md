# Trip Progress evaluation (#391)

親方針は#382/#415、ADR 0052。ADR 0027/0029の客観評価・Smoke/Full分離と
#384の[Ask + Progress](ask-progress.md)を継承する。新しいPlanner、会話進行state、
Trip field、Provider、writerは追加しない。意思決定は引き続きモデル、Domain検証はコードが担う。

## 現状 → 今回 → 後続

- 従来の42ケースは保存済み観測から6指標を採点し、#425のA〜Gは本番Runtimeの1応答を検証する。
  相談開始からのturn数、選択後のdraft、複数応答の最大質問streakは計測していなかった。
- 今回は既存`AgentTurnObservation`を集計するpure evaluatorとA〜Jの会話fixtureを追加する。
  System Prompt、Tool descriptor、検索、Trip生成・保存は変えない。
- #388/#389のwriter gate、#390の採用UI、in-trip #396、ready #402は後続のまま。
  #391時点のV2シナリオは既存の`replace`でpreviewを作る。#410で同じdetectorへActivity add/replaceを追加した。

## 指標とturn counting

旅行相談を始めたuser入力の直後のassistant **responseがturn 1**。
ユーザーに返した失敗応答も1つに数える。内部model call、Tool call、拒否された未公開回答、
同じ実行内のreplanは増分にしない。評価対象は固定されたsynthetic相談windowであり、本番会話stateではない。

| 指標 | 定義 |
| --- | --- |
| TTFC | 最初の`candidates`表示の1-based turn。複数候補が必須ではなく、identity/nameを持つ具体候補1件も可 |
| TTFI | 最初の`itinerary` preview表示の1-based turn。writer成功は要求しない |
| selection→draft | 明示選択直後の応答を1とする。各選択イベントを別記し、その後の新しいitinerary表示までを数える |
| maximumQuestionOnlyStreak | 例外を含むask_onlyの最大連続数 |
| maximumOrdinaryQuestionOnlyStreak | 正当なstructured exceptionがないask_onlyの最大連続数。raw streakと別に計算する |
| askOnlyTurns / askAndProgressTurns | `AgentTurnObservation.outcome`の総数。疑問符/発話regexで再推定しない |
| Plan Progress Rate | progressTurns / eligibleAssistantTurns。候補、比較、item Proposal、旅程、grounded decisionが分子。失敗・例外も分母に残す |
| repeatedKnownConditionQuestions | 成功した`ask_follow_up`のstructured requestedRequirement=origin/datesまたはexpectedInput=departure-dateと既知Requestの重複。不要質問の客観的に測れる下限 |

日程が既にあるだけでは新規TTFIにしない。Jの開始時の既存itemsは成果物ではなく、
その応答で表示されたreplaceのみを計測する。選択対象item IDとitineraryの参照が一致した場合のみ
selection→draftを達成する（無関係なitemの更新では不可）。未採用候補からの暗黙選択イベントも作らない。
複数選択では後の選択が前の未達成を成功に変えない。selection→draftの集約値は全選択が到達した場合の最大値。

未到達は`null`、閾値を課さないケースはthreshold fieldを省略する。未到達を0や成功と同一視しない。
選択イベントなしも明記する。途中打切り/認証失敗は欠測turnと未完了reportにし、成功率から黙って消さない。
空の評価windowは失敗。Progress Rateの分母が0ならnull。

## 表示成果物の共通判定

本番回答組立と評価は同じ`observeViewerTurn` → `observeAgentTurn`を利用する。
`VisibleProgress`の既存kindを利用し、新しい自然言語分類器や永続型は作らない。

- concreteなJourneyPlan（発着地・非空legs・有限時刻）はcomparison+candidates。検索候補でありTTFIではない。
- 名前・空でないidentity・Evidenceを持つ表示済みplaces/restaurantsはcandidates。
- 日程と具体移動があるlegacy TravelPlanはitinerary。空の往復経路だけでは不可。
- legacy add/replaceは日付付きの移動・滞在・観光itemを確認する。metadataだけは不可。
  remove/moveはtrip_proposalとして進展になるが、それだけで初回旅程到達にはしない。
- V2 replaceはselected railの非空legs、またはselected accommodationの場所を持つものを
  trip_proposal+itineraryとする。Domain validationを通過したpreviewが前提であり再検証器を作らない。
  unresolved placeholder、planning/request/assumptionだけでは不可。
- #410のActivity add/replaceはtitle/category/scheduleと任意placeを公開previewしたときitineraryとする。
  場所なし自由時間も可。内部Tool成功だけ、hidden/未公開失敗結果は数えない。
- `progressSources`は検証済みEvidence参照を持つgrounded_decision。単なる文章・引用数から
  具体候補名や複数方向性を推測してTTFCへ昇格させない。

観測点は**公開を受理されpresenterへ渡すresponse**。失敗で破棄された途中結果は数えない。
評価入力の`delivered=false`はその応答内の非表示Proposalを明示し、成果物を数えない。
公開された質問は引き続き数える。Tool単体の内部結果をassistant turn配列へ入れてはいけない。
既存のDOM rendering testが質問＋成果物、source link、V2計画事実の表示を担保する。
ブラウザのpaint完了やviewport内滞在時間を測る新規テレメトリーではない。

### 観測範囲の限界 / 後続候補

現在の`present_travel_progress`はsummary/引用/sourceだけを返し、個別方向性候補の
typed identity/比較軸がない。このため根拠付き推薦はProgressに数えるがTTFCは保守的に未到達となり得る。
POI検索を全相談へ強制する修正は行わない。A/B等のscripted fixtureだけに既存地点Toolの
typed結果を追加してdetectorを検証する。将来、方向性候補を構造化表示する契約が入るときに
共通detectorを拡張する。文面からの推測で現在の評価を良く見せない。

H/I/Jはverified candidate解決Portと既存対象itemが既にある条件の評価であり、
ゼロからのV2 item生成や現行Browser writerがV2へ移行した証明ではない。
自然な文章、引用が本当にユーザーに適するか、structured種別のない自由文の再質問等は人手/将来の主観評価が必要。

## シナリオと閾値

| ケース | 条件・観測 | 初期閾値 |
| --- | --- | --- |
| A | 曖昧希望、根拠＋具体候補＋質問 | TTFC <=3 |
| B | 既知発地/日程、候補比較→明示選択→draftの2応答 | TTFC <=2、TTFI <=2、既知条件再質問0 |
| C | 検証済み候補を明示選択 | selection→draft <=1 |
| D | Trip.request既知条件、不正な再質問を内部で拒否して回復 | TTFC <=2、TTFI <=2、既知条件再質問0 |
| E | 過去Tripの振り返り | 年/Request変更なし、偽progressなし。TTFC/TTFI閾値対象外 |
| F | hard unknownを保持し質問と候補を併記 | TTFC <=3、hard unknown維持、ask_and_progress |
| G | scriptedで1回目を実際のask_onlyにし、2回目へoutcome/historyを渡す | TTFC <=3、通常streak <2 |
| H | 具体的な日帰り先/日程/検証済み候補 | TTFI <=2（scriptedは1） |
| I | 複数日、移動と宿を同じ応答で採用提案 | TTFI <=2、selected stay必須 |
| J | 既存itemのrefinement、候補Bへreplace | TTFI <=2、具体変更、refinement維持 |
| K (#410) | 既存Tripへverified食事候補をadd | TTFI <=1、refinement、既存item不変 |
| L (#410) | 場所なしwindow自由時間をadd | TTFI <=1、質問なし、fake Place/fixedなし |

選択直後の応答は1 turn以内のdraftが必要。普通の質問のみならfail。
safety/hard_constraint_unknown/tool_input_missingはraw指標から消さず、turn番号とreasonを別集計する。
選択後のdraft未到達も例外理由付きで報告する（例外だけでTTFI成功にはしない）。
全ケースの通常streak閾値は最大1。Progress Rate、latency、call数は初期段階ではnon-gating。

## 理由分類・report・privacy

理由は観測された条件の分類であり、因果関係やモデルの内部思考の断定ではない。
回復済みのtool_failureも見えるよう、PASS時も観測signalを残す。

- ask_only_loop / clarification_required: ordinary streak超過 / 実際のask_only。
- hard_constraint_unknown / tool_input_missing: 受理されたstructured exception。
- tool_failure: traceのtool_completed error。
- proposal_rejected: 既存Proposal Toolがerrorを返した。
- runtime_limit: task_completed reason=runtime_limit_reached。
- candidate_only / candidate_not_selected: candidate表示済みだが旅程なし / さらに明示選択もなし。
- no_visible_progress: 表示進展なし。unknown: 他の観測理由を確定できない失敗。

既存の6指標を維持したままreportへ`travelProgress`を追加する。ADR 0027に従い外側は
`agent-eval-report-v3`へ更新し、内側に`trip-progress-eval-v1`を持つ。
`tests/fixtures/agent-eval-cases.json`はdataset-v2へ更新し、相談文・閾値・tagの
`travelProgressScenarios`を追加する。従来42件のcasesは変更せず、v1 reader互換も維持する。
observationsはv1のままで、A〜Jは保存済み成功観測を足すのではなく毎回Runtimeで実行する。
modelCallsは実呼出しカウンタ、toolCallsは欠落のないTrace、latencyは既存task_completed計測の合計。
不足値はnull、Trace欠落はtraceIncomplete。scripted latencyはローカル処理時間でありBedrockのlatencyではない。

reportはid・集計・固定理由のみ。会話全文、成果物payload/refs、exception.missingFact、
精密座標、Provider raw、秘密情報、内部思考を追加収集/出力しない。syntheticの履歴は評価実行中のメモリのみ。
派生JSON/Markdownは/tmpへ出し、Gitへ入れない。

## 実行とgate

```sh
npm test
npm run build
npm run architecture:check
npm run workspace:check
npm run eval:agent:smoke -- --output-dir /tmp/raiquora-391-smoke
npm run eval:agent:full -- --output-dir /tmp/raiquora-391-full
npm run eval:agent:decision:live -- --suite trip-progress --profile full --output-dir /tmp/raiquora-391-live
# 実モデルの候補選択だけを再評価する例
npm run eval:agent:decision:live -- --suite trip-progress --case C-candidate --output-dir /tmp/raiquora-391-live-c
```

- Unit: turnの1-based計算、選択別集計、hidden/空/状態のみの負例、例外と欠測、27通りの短いsequence invariantをhard gate。
- Smoke: 保存済み12ケースの6指標＋従来A/G＋Trip Progress A/C/G/K/N/O/Q/S/Uをhard gate。SはEUR宿泊価格、Uは採用済み多都市Tripを保持した進展を検証する。
- Full: 保存済み42ケース＋従来A〜G＋Trip Progress A〜Uをhard gate。M/Nは#411の既知party/年齢不明、O/Pは#413のタクシー/便未定航空、Q/Rは#400の宿採用/差し替え、SはEUR価格観測、T/Uは#403の希望/採用済み3都市の順序保持と進展を検証する。実モデル品質を証明するものではない。
- Live: 同じproduction registry/presenterとsynthetic Providerを使い、実モデルが自由にToolを選ぶ。
  閾値の微差はWARN、Domain/fixture契約違反はfail、認証/Provider失敗は未完了の非0終了。
  自由選択なのでGで最初から進展する場合もあり、raw askOnlyTurnsから実際のカバレッジを確認する。
  独立した既存Tool selection/grounding/safety評価を置き換えない。

## #390 focused-item追加

A〜Zに加えてAA（選択中Activityの調整）をSmoke/Fullへ追加した。TTFI=1、通常ask-only streak=0、
選択IDの具体的Proposal、他item/採用済みPlace/Request不変を検証する。既存thresholdは変更していない。
現行件数はSmokeのTrip Progress 11、Full 27。V〜Zは#406の候補比較、AAはUI focus境界を評価する。
詳細と再実行コマンドは[Trip workspace](trip-workspace.md)参照。

2026-09-12および2026-09-13の確認では`aws sts get-caller-identity`が`Your session has expired`で失敗した。
Live未実施。既存方式で再認証後、上記コマンドでTTFC/TTFI、selection→draft、streak、Progress Rate、
理由、model/tool calls、既存latencyを確認する。認証方式変更やキー抽出は行っていない。

## #402追加ケース

AC impossible itinerary / AD reservation conflict / AE unknown factsは
`feasibility-progress-scenarios.fixture.ts`から本番Runtime・Context・Tool/Proposal・Controller ready gateを検証する。
違反を説明だけで消せないこと、未確認を成立へ変換しないこと、予約private値をモデルへ渡さないことを確認する。
SmokeのTrip Progressは15件、Fullは31件（A〜AE）。既存A〜ABのTTFC/TTFI等の閾値は変更しない。
新3件もscripted IOによる契約回帰でありLive品質の測定ではない。

## #392 / #401追加ケース（現在の件数）

AF ready後の準備 / AG 予約未確認 / AH 準備提案の重複は[Readiness](trip-readiness.md)を検証する。
AI 公的ハザード≠Trip影響は[HazardAlert](hazard-alert.md)を検証する。
現在はSmokeのTrip Progress 19件、Full 35件（A〜AI）。上記各Issue時点の件数に追加したもので、
既存A〜AHのthresholdは変更していない。新旅程生成を要求しないAF〜AIはTTFC/TTFI=nullのまま扱う。
AIは公的severity/Evidence/検索範囲をモデルへ渡す一方、Trip・Feasibility・準備状態不変と
通知等の別Actionが実行されないことをproduction Runtimeのscripted回帰として確認する。
