# Ask + Progress (#384)

正本は #382/#415、[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)、
[Trip lifecycle](trip-lifecycle.md)。新しいTrip・会話進行モデルではなく、Agentの回答品質契約を追加する。

## 現行からの変更

| 境界 | Before | After |
| --- | --- | --- |
| ask_follow_up | terminal responseになり、質問だけでも実行完了。前の質問のみ回答を認識しない | structured質問と具体成果物を同じturnで組み立て、完了直前にoutcomeを観測する |
| Runtime | terminal Tool名または最終textで完了 | 連続ask-onlyを検出し、同じ実行上限内でモデルへ再判断を返す |
| Viewer response | conversation/旅程/経路/外部情報の優先分岐で一部が隠れる | 質問と成果物を同時表示。質問は成果物を隠すUIモードにしない |
| V2 Context | #383/#387の読み取り投影があるが、production adapterの入力はlegacy TripPlanだけ | 同じproduction adapterへgetCurrentTripと候補解決Portを接続可能にする。Trip.request・状態・時間評価をモデルへ渡す |
| 候補採用 | #385/#383 Application入口はあるがモデルから呼べない | IDだけのToolから既存入口を呼び、V2 Proposalを返す |
| Eval | 保存済み観測やTool選択のみの評価が中心 | 本番と同じRuntime/Tool/回答組立のA〜Gを毎回実行する |

## 一時的な回答観測

`agent-turn-outcome.ts`の`AgentTurnObservation`を使う。

- `ask_only`: structuredな質問があり、具体的な成果物がない。
- `ask_and_progress`: 質問と成果物の両方がある。
- `progress`: 成果物があり質問はない。
- `answer`: 上記に該当しない回答。

質問は`conversation.question`または既存Decision Summaryの`selectedAction=ask_user`から判断する。
自然言語末尾の疑問符や発話regexでは分類しない。structuredな質問契約を使わない自由文の
意味評価はLive Evalで確認する対象であり、句読点検出による補助routerは追加しない。

Progressは実際にpresenterへ渡す候補・経路比較・旅程・item更新Proposal・根拠付き具体判断から導出する。
V2のstate/requestだけのPatch、空候補、未確認Evidence ID、検索Toolを呼んだ事実、完了報告だけは数えない。
PlanAssumptionは既存の型で提案できるが、仮定だけの列挙を具体的な候補や旅程と同等には数えない。

`viewer-composition.ts`はsession IDごとに直近の完了outcomeだけをメモリ保持する（最大20session）。
会話切替で混在させず、実行開始時のsession IDへ記録する。タブ再読込・eviction後はunknownから始める。
新しいLocalStorageキー、ConversationSession field、Trip fieldは作らない。
Traceにはaccepted/rejected、outcome、成果物の識別参照、短い例外理由だけを残す。内部思考は保存しない。
秘密情報のredaction・精密座標のredaction・上限・server側のallowlistを適用する。

## 連続質問の制約

直前がask_only、今回もask_only、例外なしの場合、回答公開前に再計画を求める。
モデルが次のTool/候補/質問を選ぶ。固定Planner、state別Tool allowlist、常時Reflectionは追加しない。
再判断も既存maxIterations/maxModelCalls/maxToolCalls/timeoutに含む。上限に達した場合は既存の安全な
未完了応答とし、拒否済みの質問や部分結果を成功として返さない。最終Viewer Actionは回答受理後に検証適用する。

質問を優先できる`askOnlyException`は次の3種類に限定する。

- safety: 利用者にしか確認できない安全条件。モデルが不足事項を短く外部化する。
- hard_constraint_unknown: 既存Domain評価がunknownのconstraint IDを要求する。
- tool_input_missing: 当該実行の登録済みTool入力validationが実際に検出した必須field不足だけを許可する。
  存在するTool/fieldを指定するだけでは例外にならない。意味上その値を利用者へ聞くべきかはモデルが判断する。

例外でも出せるProgressがあれば併記する。候補を出せるのにask-onlyで止まった実行はA〜G Evalで失敗になる。

## 既存Domain/Applicationの再利用

`trip-progress-tools.ts`は能力contractとApplicationへの接続だけを持つ。

| Tool | 実行境界 |
| --- | --- |
| propose_candidate_selection | candidate ID/item ID → 既存CandidateSelectionPort → verified snapshot → proposeCandidateSelection → 同じTripUpdateProposal。別task/期限切れ/未検証を拒否し、採用＋itinerary_draftを原子的に提案する |
| propose_request_assumptions | 同じTripRequestをvalidateしproposeTripRequestUpdate(..., model)へ渡す。既存条件や確認状態を上書きしない。仮定はmodel/unconfirmedのまま |
| present_travel_progress | 当該実行でread_web_pagesが取得した本文・Evidenceと短い引用を照合し、推薦判断＋比較材料＋参照リンクを提示する。未読URL・架空引用・Evidence欠落は拒否する |

引用は最大4件、1引用10〜100文字、同一URL合計100文字以内とする。モデルのsummaryは推薦判断であり、
コードが全文の意味的正しさを証明する仕組みではない。既存Evidence/Claim validationを維持し、
Tool本文と引用の一致・情報源の存在を決定論的に確認する。推薦の妥当性はLive Eval/人手レビューで別途測る。

採用提案では実際の駅・列車・scheduled日時を表示する。生JourneyRouteResult・delay・現在状態を保存しない。
元Tripは変更しない。未選択宿やunscheduled/day/windowは保持する。既存hard評価のunknown/violatedは
未成立と明示する。時刻不足を0時や現在時刻で埋めない。

仮定は回答内に`⚠ 仮置き`を表示する。confirm/rejectは#387の`proposeAssumptionDecision`と
`planAssumptionViews`の操作契約を再利用し、モデルに確認権限を付与しない。

## Context・本番配線・writer gate

`runViewerAgentRuntime`は`getCurrentTrip`で得たV2 Tripを、既存`createAgentContextSnapshot`へ渡す。
Requestがある場合、legacy TripContext/history-derived条件は正本にしない。
`requestedRequirement`/structured input種別で既知の条件に対する質問をDomain投影と照合する。
候補集合・採用済みTrip・realtime factsは別fieldであり、先頭候補の暗黙採用はしない。

実時計を注入する`assessTripTime`、`evaluateTripHardConstraints`の結果も同じContextへ渡す。
圧縮後もRequest、直前outcome、過去/unknownの時間評価、hard unknownを残す。
年の補正・過去Requestの新旅行への自動転用・lifecycleの自動書替えは行わない。
stateは期待成果物の目安であり、Tool選択条件ではない。

**現行ブラウザのTrip writerは引き続きlegacyである。** 同じproduction Runtimeの質問＋成果物の組立と
直前outcome配線は有効だが、V2 Tripを保存・復元する本番Repository自体は#388/#389の責務である。
V2読取Portが提供された場合のRequest/候補/Proposal経路を今回完成させ、本番Runtime入口のテストで検証する。
legacyから一時的な別Trip正本を勝手に作ってV2が稼働済みと見せかけない。
UIではV2 Proposalはpreviewだけで、legacyの「旅程に反映」callbackへ流さない。
V2の保存/採用UI統合は#388/#389のgateと#390に従う。migration・dual-write・Conversation削除の変更なし。

## 評価・再実行

`ask-progress-scenarios.fixture.ts`はProviderの録音ではなく、架空地域とバージョン管理された時刻表fixtureを使う。
scriptsは意図したモデル応答を固定するが、Tool selection後のDomain/Runtime/Policy/presenterは本番実装を通す。
ツール呼出だけ、空Proposal、質問だけをProgressとして通すshortcutは使わない。

| Case | 確認 |
| --- | --- |
| A 曖昧 | 地域未定でも根拠付き方向性＋出発地域の質問 |
| B 条件あり | 予算等の入力完了を待たず比較材料 |
| C 候補選択 | verified candidate解決→draft Proposal、未選択宿の時間未定保持 |
| D 既知Request | origin/date再質問を拒否、既存条件優先 |
| E 過去Trip | pre_tripでも2025年のままpast、振り返りと新規旅行を区別 |
| F hard unknown | 京都18時帰着を未成立のまま保持、可能な比較＋質問 |
| G 連続ask-only | 最初の質問のみを未公開で再判断し、同じturnで根拠付き進展 |

SmokeはA/G、FullはA〜Gを既存Evalに追加し、JSON/Markdownへoutcome・model/tool call数・失敗理由を出す。
Liveは同じproduction Runtime＋実Bedrock、外部情報は同じsynthetic fixtureを用いる。
既存のTool選択だけを評価するLive suiteとは分離する。

```sh
npm run eval:agent:smoke
npm run eval:agent:full
npm run eval:agent:decision:live -- --suite ask-progress --profile full --output-dir /tmp/raiquora-384-live
```

2026-09-12のLive試行はAWSの`CredentialsProviderError: Your session has expired`で最初のBedrock呼出の認証段階に失敗した。
認証方式は変更していない。A〜Gのlive model品質は未評価であり、scripted passをその代わりに主張しない。
利用者による認証更新後、上記コマンドで再実行する。

専用の常時model callは追加しない。scriptedのmodel/tool回数はA/B/F=3/4、C=1/1、D=4/5、E=1/0、G=4/4。
拒否後の再判断には追加callが必要になる。実環境のlatency/成功率は認証復旧後に測る。
TTFI/TTFCの本格計測・SLOは#391、in-trip専用Contextは#396、readyの成立性証明は#402へ残す。

## Acceptance Criteria自己レビュー

- 連続質問: G、例外3種類、上限時の部分結果非公開を検証。
- 条件未確定の候補/仮案: A/B、仮定可視化、UI表示を検証。
- hard unknown: FとDomain評価、例外ID照合を検証。
- 既知条件: D、persisted優先、却下仮定の非再利用、Context圧縮を検証。
- Candidate→draft: C、ID解決、scheduled factsの表示、元Trip不変、偽ID拒否を検証。
- 別正本なし: Domain/storage schema変更なし。観測はtab memoryと既存Traceだけ。
- routerなし: 異なるstateで同じTool集合をモデルへ渡すテスト。例外もToolの強制選択をしない。
- 過去Trip: E、年保持・past評価・Request不変を検証。
- grounding/safety回帰: 全既存テストとSmoke/Full、未読/架空引用/根拠欠落の拒否を検証。Live未評価を明記。
