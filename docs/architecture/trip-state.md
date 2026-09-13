# Trip V2の計画・旅行状態 (#383)

正本は #382/#415、[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)、
[Trip lifecycle最終契約](trip-lifecycle.md)。#387までの同じTripへ状態を加える。
本番writerの切替ではなく、Domain / メモリ上のProposal / Agent読み取り投影の導入である。

## 現行 → 今回 → 後続

| 現行の所在 | #383の変更 / 境界 |
| --- | --- |
| `travel-profile.ts`のTripContext.planningStage | inspiration/planningのlegacy値。V2ではTripのplanningStateだけを正本とする。legacy型には新しい状態を足さない |
| `travel-conversation-context.ts` | 旧状態の復元・引継ぎ。V2状態の発話regex routerに流用しない。writer切替時に旧producerを撤去する |
| `viewer-agent-runtime.ts` | legacy状態のparser、質問Context、旅程生成、応答projectionがある。今回はV2へ接続し直さず、別の固定進行ルールも追加しない |
| `structured-model-class-policy.ts` | legacy条件によるモデルクラス判断。V2 stateをToolやモデルの固定振分キーとして追加しない |
| `ai-guide-panel.ts` | legacy旅程相談のplanning指定。V2へ二重書込しない |
| `trip.ts` / `select-trip-candidate.ts` | Tripに2軸を追加。同じPatchに状態変更を追加し、候補採用とdraft化を原子的に扱う |
| `agent-context-snapshot.ts` / `agent-decision-context.ts` | 読み取り投影だけ。Request・仮定・今回のAgentDecisionと別fieldで渡す |

V2 writer未導入のため、現在稼働するlegacy会話の全進行が本PRだけで変わるわけではない。
#384は本状態とTripRequestを使用し、conversationPhase/planningStep/askProgressStateを別正本にしない。
#384で追加したproduction Runtimeの読取Port・注入ClockのContext評価・回答観測は
[Ask + Progress](ask-progress.md)を参照する。Repository/writer切替とlifecycleの自動書込は依然として未有効である。

## 同じTripの2軸

- planningState: `inspiration | candidate_discovery | candidate_selection | itinerary_draft | itinerary_refinement | ready`
- lifecycleState: `pre_trip | in_trip | completed | cancelled`

新規Tripはinspiration/pre_trip。これは日付や経路の確定ではなく、開始・完了を未確認の初期状態。
createTripのplanningState引数で直接draftから作ることもできる。段階の順序を強制しない。
探索・比較状態は今の作業目的の表明であり、特定Toolを実行済みであるというEvidenceではない。
draft/refinementは採用済みitemを1つ以上必要とする。未選択宿・未解決移動・unscheduledでもdraftを保存できる。
in_trip/completedも空Tripでは認めない。旅行中のrefinementや方向性の見直しは可能。

`ready`の認定は#402の[Trip Feasibility](trip-feasibility.md)をApplicationで検証する。
選択済み経路がある、予約がある、モデルが自信を示した等だけでは認定しない。違反・unknownを拒否する。
保存済みreadyは構造validationで読める。後で評価が変わってもplanningStateを自動変更しない。

## Proposal / 確認

TripPatchに`planning {state}`と`lifecycle {state, basis}`を追加する。
既存replace/requestと合わせ、最後のitems/Request/stateを検証してから新Tripを返す。
不正なPatch列は元Tripを変更しない。既存ID・schemaVersion・revision・updatedAtを保持する。
状態enumだけを出力するAIにwriter権限を与えない。

- `proposeTripPlanningState`: AI/UIの提案をDomain validationへ渡す。Tool名や質問順は扱わない。
- `proposeCandidateSelection`: 既存task-local候補解決・許諾・時刻表再検証を維持し、
  対象itemのreplaceとdraft化を同じProposalへ入れる。既にrefinementならその状態を維持する。
  `confirmCandidateSelection`は再解決・再検証後に適用する。未確認候補はTrip不変。
- `proposeScheduledLifecycle`: 注入Clockで評価し、更新候補がある場合だけProposalを返す。
  適用時にもApplicationが渡したClockで最終itemsを再評価する。古い時刻評価の自己申告を信用しない。
- `confirmTripLifecycle`: 明示的な利用者確認のApplication入口。DomainにはPatchのbasisとは別に
  confirmedLifecycleを渡す。LLMがbasis=user_confirmationと書いたPatchだけは拒否する。
  今はAI Tool/HTTP endpointへ公開しない。将来の呼出側も信頼されたUI操作を確認し、認可は#388/#389で検証する。

completed/cancelledはterminalで、時計によっても通常Patchによっても再開しない。同じ確認の再送は同結果。
再開機能・archivedAt・item実績は本Issueで先取りしない。将来必要なら明示契約を追加する。
Requestのみの変更で、既存items・planning/lifecycleを無言で変えない。

## 実時計と時間精度

`assessTripTime(trip, clock)`はitems.scheduleとlifecycleStateだけを読む。
Clockは`now(): Date`をApplicationから注入し、1評価につき1度だけ読む。
実時計のproduction配線はwriter gate後。Viewerのシミュレーター時計・ブラウザzone・
TripRequestの希望日・migration日時・会話の日付を旅行期間の根拠にしない。
戻り値のassessedAt/itemIds/precisionは派生評価であり、Tripへ保存しない。

| schedule | 時間評価 | 自動lifecycle候補 |
| --- | --- | --- |
| fixed + endAt | offset instantで開始包含・終了排他。全itemがこの精度なら最早開始〜最終終了の間もcurrent | upcoming→pre_trip、current→in_trip |
| fixed、終了不明 | 開始前はupcoming、開始後はunknown | 開始前pre_tripのみ |
| window | 最早開始/最遅終了の範囲。currentは配置可能範囲内という意味 | upcomingならpre_trip、currentからin_tripにしない |
| day + zone | Intlの明示IANAでClockの暦日と比較。endDateはcheckout排他 | upcomingならpre_trip、currentからin_tripにしない |
| day、zone不明 / unscheduled | unknown。00:00や端末zoneを捏造しない | なし |

全体は全itemの位置から導出する。1つでもunknownなら全体unknown。
全て過去ならpast、全て未来ならupcoming、それ以外は期間内current。
非fixedを含むcurrentはboundedで、実行中の証明にはしない。
fixedでも「採用された計画上、旅行期間内」という意味であり、訪問・乗車実績ではない。

**時刻だけでcompletedにはしない。** 終了が分かるfixedのpastであっても、今は明示確認を必要とする。
将来のitem実績を使った終了判断はこの時間評価とは別に接続する。done/skipped/visitedを作らない。
terminal状態でも時間評価自体は返すが、lifecycle候補を返さず復活させない。

## 単一converter / 過去Trip

`convertLegacyTripPlan`の同じ入口を拡張する。

- inspiration → inspiration
- planning + 変換済みV2 itemsあり → itinerary_draft
- planning + V2 itemsなし → candidate_discovery
- planningStage欠落/不正 → inspiration + planning-state-unresolved warning
- lifecycleはpre_trip + lifecycle-unverified warning。legacyの日付だけで実行/完了を認定しない

RequestへplanningStageは入れない。元raw保持、入力不変、同じ入力で同じ結果を維持する。
Activity未導入によるdeferred itemを完成したItineraryとして数えない。
2025-09-22の旧旅程を2026-09-12に復元しても2026-09-22へ補正しない。
zone不明ならunknown、明示zoneがあればpast。pre_tripは「将来予定」の証拠ではない。

## Agent / 評価 / 後続

currentTripのplanningState/lifecycleStateは読み取り投影。persistedTripRequest、hard/soft、
assumptions、currentTurnDecisionと混在させない。圧縮時も状態を保持し、採用scheduleの
部分表示はscheduleTruncatedで明示する。Context文で状態をTool/質問順のキーにしないこと、
過去年の補正禁止、Viewer日時から旅行日/実績を推論しないことを明示する。
Tool descriptor・registry・実行上限・Evidence/Claim/Viewer policyは変更しない。

Domain/Usecaseテストはenum、不正/atomic、段階skip、採用→draft、時差/日跨ぎ/精度、
Request独立、terminal、過去年、migration不変/決定性、Agent分離/同じ能力集合を確認する。
既存Smoke/Full Evalは保存済みObservationの回帰検査であり、実モデル品質の保証とはしない。
Live runnerには同じcandidate_discoveryでWeb/天気の異なる能力を選ぶ2ケースを追加する。
設定済みAWS認証が期限切れのため今回のLiveは未実施。認証方式は変更しない。

```bash
npm run eval:agent:decision:live -- --profile full --case trip-v2-state-free-search_web --output-dir /tmp/raiquora-383-live-web
npm run eval:agent:decision:live -- --profile full --case trip-v2-state-free-search_weather_forecast --output-dir /tmp/raiquora-383-live-weather
```

#384: Ask + Progress・本状態を使った意味解釈/会話進行。#391: TTFI/TTFC。
#402: readyの成立性証明。#396: 本格的なin-trip Agent Context。
#388/#389: 認可、server保存、revision/CAS、writer配線。#390: UI導線。
V2 LocalStorage writer・server Repository・dual-write・会話削除変更は今回行わない。

## #383 AC自己レビュー

| 受け入れ条件 | 確認箇所 |
| --- | --- |
| 曖昧な希望をinspiration/discoveryで扱う | Trip新規状態、planning patchのテスト。発話の意味解釈はLLM |
| 具体条件なら途中stateをskip | createTripの初期planning指定、inspiration→draftのDomain/usecaseテスト |
| 候補選択後draftへ進める | 既存candidate selectionテスト、replace+planningの原子的適用 |
| 過去Tripを新しい将来予定にしない | legacy-trip-state / agent-trip-state-contextの2025→2026回帰 |
| 十分な時刻根拠があればin_trip | fixed・日跨ぎ・Vienna/Tokyo・適用時Clock再確認のテスト |
| 不十分なcompletedを捏造しない | day/window/unscheduled/終了不明/過去fixedの非自動完了テスト |
| 正本はTripだけ | Request/AgentDecision非混在テスト。Storage/旧Contextへの新規書込なし |
| 構造化stateとvalidation | enum/unknown field/未確認basis/atomic拒否テスト |
| 固定Plannerにしない | 状態別同一Tool集合のテスト。Live用の同一state・異なるToolケース |
| 単一converter・原本不変 | legacy mappingの不正stage・決定性・入力不変テスト |
| writerはまだ無効 | 既存LocalStorage/API/認可/会話削除コードの差分なし |
