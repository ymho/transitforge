# Trip V2: 正本契約と段階移行

決定日: 2026-09-12。設計の親方針は [#382](https://github.com/ymho/transitforge/issues/382)、
本契約の担当は [#415](https://github.com/ymho/transitforge/issues/415)、判断記録は
[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)とする。

#384の回答観測・Runtimeへの接続・評価・writer gateの実装記録は[Ask + Progress](ask-progress.md)を参照する。
#410のActivity/add/候補採用と部分migrationは[Activity導入記録](trip-activity.md)を参照する。
#389の既存revisionを使うCAS/Proposal/receipt/競合回復は[更新契約](trip-concurrency.md)を参照する。
#393の独立Watch・Event・Impact、owner逆引きと差分reconcileは[監視境界](trip-monitoring.md)を参照する。
#407のTrip永続更新→Watch同期は[transactional outbox配送](trip-changed-delivery.md)を参照する。
#394の[鉄道Impact評価・内部逆引き・保存](rail-trip-impact.md)はTripの計画・予約・Feasibilityを変更しない。
#408の[天気・警報Impact](weather-hazard-trip-impact.md)も同じWatch/Event/Impactを使い、trusted areaとscheduleを照合する。
時間起点の再検査は[Trip recheck runtime](trip-recheck-runtime.md)で扱う。通知の決定・永続化・配信は[Notification runtime](notification-runtime.md)で分離する（#395 / ADR 0063）。

**これは採用する最終契約であり、V2が稼働済みという記述ではない。** #415では文書だけを変更する。
現在稼働している型・保存処理は下表のlegacy実装である。後続Issueは本契約を同じ
`modules/trip/domain`へ段階実装し、別のTrip V2、Planner、平行した要求モデルを作らない。
以下の型の骨格は文書内の設計記法であり、import可能な未使用の型を先行公開しない。

#385では同じ契約の最小コアをコードへ導入した。実装済みfield、legacy読書き維持、未完成の
converterとwriter gateの状態は[Trip V2コア導入](trip-v2-core.md)を参照する。
以下は引き続き最終契約であり、全field・全migrationの完了を意味しない。

## 1. 現行実装 → 決定 → 実装担当

監査基準はmain `31a6517`。Issue本文の例ではなく次の実コードを確認した。
パスはrepository rootからの相対パスとする。

| 現行実装・観測 | V2の決定 | 実装担当 |
| --- | --- | --- |
| `modules/trip/domain/travel-plan.ts`: `TravelPlan`は往復検索と宿泊候補の応答束。`TripJourneyPlan.journeys[]`を含む | 検索/比較の入力に限定し、最終的に新規生成を廃止。Tripではない | #385 |
| `modules/trip/domain/trip-plan.ts`: `TripPlan.version: 1`、採用宿と`options`、経路配列が混在 | 将来の唯一の編集正本は`Trip`。`TravelPlan`でも旧`TripPlan`でもない | #385 / #389 |
| `trip-plan-panel.ts`と`agent-context-snapshot.ts`は`journeys[0]`を表示 | 先頭表示をユーザーの採用証拠としない。選択済み経路1件と未選択placeholderを区別 | #385 |
| `JourneyRouteResult.legs`はdelay値・補正済み時刻も含み得る | 検索結果を直接保存せず、計画専用`SelectedRailJourney`へ明示変換する | #385 |
| `selectTripPlanAccommodation`は全stayへ同じ宿を反映する | 選択対象item IDを指定する。多都市の他の宿を変更しない | #385のV2採用境界 / #390のUI移行。#403は地点projection |
| `modules/trip/domain/travel-profile.ts`: `TripContext`に今回条件と`planningStage`が同居 | 今回要求は`Trip.request`、状態は`Trip`、Profileは別リソース | #383 / #387 / #411 |
| `frontend/src/domain/travel-conversation-context.ts`: 発話・埋込文から日付/泊数/状態を解釈するlegacy helper | 新しい発話routerへ発展させない。意味解釈はBedrock、日付・時刻検証はDomain | #383 / #387 / #384 |
| `frontend/src/usecases/trip-plan/trip-plan-repository.ts`: `plansBySessionId`、20件上限、store `version: 2`とplan `version: 1` | Trip IDで独立保存。store番号をDomain schema番号と混同しない | #388 / #389 |
| 同repositoryは不正な1項目でplan/store全体を読めなくする。`wikipedia`復元も不一致 | 旧readerの不具合は#404。V2移行では原本を残してrecord単位の失敗を報告 | #404 / #388 |
| `applyTripPlanPatches`はvalidationと異なり存在しないreplaceをupsertする。既存testもこれを期待 | 原子的なvalidate+apply、暗黙upsert禁止を継承 | #405 → #385 / #389 |
| `frontend/src/adapters/browser/conversation-session-repository.ts`のcleanupが履歴と旅程を削除 | 会話削除/20件evictionはTripを削除しない | #388 |
| `ConversationSession.tripPlanId?`はあるが保存検索キーはsession ID | `tripId?`を参照する複数会話対1Trip。UUIDをTrip IDとして流用しない | #388 |
| `TripAccommodation`と`AccommodationOffering`が重複、価格・空室の観測時刻が不足 | 現在のOffering、採用時Snapshot、予約状態を分離 | #400 / #398 |
| `MovementMode`は鉄道中心、観光は`sightseeing`、日時は主にdate | transport/stay/activityと共通schedule、Placeを適用 | #386 / #410 / #413 / #414 |
| `TravelPrice`と集計は整数JPY、`destination`は単一文字列 | Money原通貨、訪問地点の正本はitems、destinationは表示用要約 | #412 / #403 |
| Trip用のサーバRepository/API/予約/監視/通知は存在しない。既存DynamoDBは運行分析等、S3はFeedback/Trace等 | 後続で既存Node Lambda内にApplication/Adapterを追加。既存テーブルやTraceをTrip保存先に転用しない | #388 / #393–#409 |

関連する実テストは `modules/trip/domain/trip-plan.test.ts`、`travel-candidate.test.ts`、
`frontend/src/usecases/trip-plan/trip-plan-repository.test.ts`、
`frontend/src/adapters/browser/conversation-session-repository.test.ts`、
`frontend/src/usecases/agent/agent-context-snapshot.test.ts`にある。
会話と旅程の同時削除、1会話1旅程、暗黙upsertを期待するテストは、担当Issueで新契約へ更新する。
「既存テストを維持する」は、置換対象の古い挙動まで永久維持する意味ではない。

## 2. Aggregateと所有権

```text
認証主体 ── 所有/権限 ── Trip (独立ID、schemaVersion、revision)
ConversationSession[*] ── tripId? ──┘
                            Trip
                            ├─ request: TripRequest (1個、条件/仮定/party)
                            ├─ planningState / lifecycleState
                            ├─ title / summary metadata
                            └─ items: ItineraryItem[] (採用済み、順序付き)
                                 ├─ transport (計画専用SelectedRailJourney等、または未確定)
                                 ├─ stay (選択済み1宿、または未確定)
                                 └─ activity (食事/観光/体験/自由時間等)

Provider result → Offering → TravelCandidate (比較用、Tripとは別)
                         選択 → Proposal → 検証/確認 → SnapshotをTripへ採用
Reservation[*] ── tripId + item ID ── Trip (予約は別aggregate)
verified JourneyRouteResult (検索結果、realtimeを含み得る)
  └─ 計画事実だけを検証・変換 → SelectedRailJourney (Trip内の採用時snapshot)
                                └─ serviceDate + serviceUid等で外部観測と照合
TrainOperation / TravelEvent (現在状態) ── Trip revisionと照合 → TripImpact
Trip → TripWatch (revision付き派生索引)
外部観測 → TravelEvent → TripImpact (Trip revision + 外部根拠)
                                    └→ Notification → Delivery
```

Tripの子entityはitemとID付きconstraint/assumption。TripRequest、Schedule、PlaceSnapshot、Moneyは
Tripが所有するvalue objectで、独立した書込Repository/revisionを持たない。
Itineraryは`Trip.items`の呼称であり、並行する`ItineraryRepository`は作らない。
Candidateは比較用の別モデル、Reservationは別aggregate、Watch/Impactは派生物、通知は配信状態である。

| 層 | 所有する責務・配置 | 持ち込まないもの |
| --- | --- | --- |
| Domain | `modules/trip/domain`: Trip/要求/items/snapshot/validation/pure migration。train/journey/operationの既存計算を参照 | DOM、Storage、HTTP DTO、Bedrock、AWS SDK、Provider raw payload |
| Frontend Application | `frontend/src/usecases/trip-plan`: 選択・提案確認・移行UIの進行。`usecases/agent`: bounded Context、Tool、Evidence/Claim/Policy | LocalStorage操作実体、永続状態の別正本、固定質問順 |
| Backend Application | `backend/agent-api/src/usecases`: 認可されたCRUD、適用、取込。`src/ports`: **唯一のTripRepository port** | DynamoDB式、HTTP status、Provider実装 |
| Adapter | `frontend/src/adapters/browser`の移行元/キャッシュ、`adapters/http`のTrip client、Backend `adapters`の永続化/外部情報 | 独自の時刻・制約計算 |
| API contract | `backend/agent-api/src/contracts`のversioned DTOとFrontend HTTP parser | DBのPK/SK/GSI、認証情報、raw Profile、Domainの別コピー |
| UI | `presentation/trip-plan`等の描画・操作・選択item ID。Frontend usecaseの操作Portへ委譲 | 保存正本、Tool選択、文字列による旅行状態推定 |

既存Backendは`ports`が`usecases`から独立する規則なのでRepository portはそこへ置く。
Browser向けの非同期操作PortはHTTP clientの境界であり、同名の別Domain Repositoryを増やさない。
shared Application packageや新サービスは不要。純粋なlegacy変換はDomainの単一converterへ置く。
#388の新規migration JSON/marker操作はBrowser Adapterへ置く。既存trip-plan repositoryのStorage注入helperは
互換呼出し元を維持し、全面的なPort注入/Browser移設は本番writer移行時の互換整理へ残す。

## 3. Trip / TripRequestの最終形

以下の参照型の意味・必須条件は本書の各節で定義する。`?`は未確定/未取得を許す意味であり、
空値を正常な値へ補う許可ではない。

```ts
interface Trip {
  id: string;                     // Application発行の不変なUUID
  schemaVersion: 2;                // Domainの保存可能な構造の世代
  revision: number;                // 非負safe integer、初回0
  title: string;                   // 表示用、意味上の目的地キーではない
  summary?: string;
  summaryDestination?: string;     // 表示/検索補助のみ
  request: TripRequest;            // 今回要求の唯一の正本
  planningState: PlanningState;
  lifecycleState: LifecycleState;
  items: ItineraryItem[];          // 採用済み、空配列も可
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;             // 保管/UI状態。旅行終了とは別
}

type PlanningState =
  | "inspiration" | "candidate_discovery" | "candidate_selection"
  | "itinerary_draft" | "itinerary_refinement" | "ready";
type LifecycleState = "pre_trip" | "in_trip" | "completed" | "cancelled";

interface TripRequest {
  goal?: string;                   // 今回の目的/気分、事実のEvidenceではない
  constraints: TripConstraint[];
  assumptions: PlanAssumption[];
  party?: TripParty;
}

interface TripConstraint {
  id: string;
  strength: "hard" | "soft";
  source: "user" | "profile" | "assumption" | "legacy";
  assumptionId?: string;           // source=assumptionなら必須
  scope: { type: "trip" } | { type: "item"; itemId: string };
  requirement: TripRequirement;    // 下表のdiscriminated union
}

interface PlanAssumption {
  id: string;
  text: string;
  status: "unconfirmed" | "confirmed" | "rejected";
  source: "model" | "profile" | "legacy";
  affects: Array<
    | { type: "constraint"; constraintId: string }
    | { type: "item"; itemId: string; field: "schedule" | "place" | "selection" }
    | { type: "party" }
  >;
}
```

Tripは旅程が空でも存在できる。旅行を計画対象として作成/採用した時点でApplicationが生成し、
一般の雑談や新規会話を開いただけでは生成しない。UI明示操作または確認済みProposalを入口にする。
IDは会話や目的地から再計算しない。全item IDはTrip内で一意、不正Patchは全体を拒否する。

### 要求の型と意味 (#387)

#387で導入したコード、legacy field棚卸し、仮定確認と評価の最小境界、未導入責務は
[Request導入記録](trip-request.md)を参照する。partyは#411、Money/budget上限は#412で導入済み。本番writerは未有効であり、以下は最終契約を示す。

同じ出発地/日付等を`TripRequest.origin`と`constraints`の両方へ保存しない。
次の`requirement.type`によるunionを1つ定義し、検索条件はそこからderiveする。

| type | 値 | 意味・validation |
| --- | --- | --- |
| `origin` | `place: PlaceSnapshot` | 地域だけ/名称だけも可。出発地と自宅を同一視しない |
| `destinations` | `places: PlaceSnapshot[]`、`order: fixed \| flexible` | 行きたい場所。実際に採用した訪問地はitems。未選択希望を採用扱いしない |
| `dates` | `start: { earliest: LocalDate; latest: LocalDate }`、任意`end`同型、任意`timeZone` | 両端inclusive、同日ならexact。9/21頃はrange/未解決のまま、勝手な年補正なし |
| `duration` | `unit: nights \| days`、`minimum`、`maximum` | 0泊は日帰り、泊数不明は0にしない。daysは1以上、nightsは0以上の整数 |
| `depart_after` / `arrive_by` | `at: ZonedInstant`、`place: PlaceSnapshot` | いつどこを出る/どこへ戻るか。帰宅と駅到着の不足区間はunknown |
| `budget` | `limit: Money`、`basis: trip \| per-person` | 取得していない費用を含む総額保証ではない |
| `mobility` | 任意`maxTravelMinutes`、`maxTransfers`、`modes/excludedModes/requiredModes: TransportMode[]`、`carAvailable`、`transferPace`、`rankingPreference`、既存列車除外/必須条件 | V2のTransportModeと既存Journey契約を再利用。発着区間scopeを保持 |
| `experience` | `intent: prefer \| must \| avoid`、`text`、任意の既存`TravelPreference`、任意`weight` | 希望・must/avoid。文章条件を機械的に証明できなければunknown |
| `pace` | 0〜1の`value` | 普段のProfile値と今回希望を分離 |
| `relative_distance` | `direction: nearer \| farther`、`comparedCandidateIds: string[]` | 比較対象のない「遠く」を絶対距離に変えない |
| `adventure` | 既存`adventureIntensity`、`avoidedRisks: AdventureRisk[]` | 既存安全制約を緩めない |

これは全自然言語DSLではない。表現不能な発話は会話/goalに残し、モデルが適切な構造化変更を提案する。
未知のrequirement discriminatorは拒否し、新type追加時はDomain/parser/migrationを同じ担当で更新する。
kind/valueを無制限の`unknown`や自由なJSON pathで保存しない。

- **hard/softと確定/仮定は別軸**。モデルがhardと呼んだだけで確定条件にならない。
- Profileは別Context。今回使う値として採用する場合はsourceを記録し、ユーザーの今回条件を優先する。
- source=assumptionは既存assumptionを参照。unconfirmedは確定条件へ昇格させずUI/Contextへ明示する。
  confirmed/rejected操作は関連constraint/itemと原子的に更新する。rejectedを検索条件へ使わない。
- 既知条件はTripRequestから渡す。`AgentDecision`/summaryは一時的な解釈・監査結果であり、
  保存済みTripRequestを毎ターン無条件上書きしない。履歴内の旧TripContextも正本へ書き戻さない。
- 日付rangeと泊数から得られる候補日程はprojection。実際の採用時刻はitem.schedule。
  希望を変更しただけで予約や全itemの時刻を自動変更しない。

### TripParty (#411)

`TripRequest.party`だけに今回の同行者を置く。
`adults: number`、`children: Array<{ ageGroup?: ChildAgeGroup; age?: number }>`、
任意`composition: TravelCompanion[]`、`source: user | profile | legacy | assumption`、
任意`assumptionId`を持つ。人数は非負整数・合計1以上。不明ならparty自体を未設定にする。
年齢不明の子は`{}`で保持でき、0歳や幼児へ推定しない。Profileからの未確認採用にはassumptionを付ける。
人数の一部だけ判明した場合も未確認分を確定人数と見なさず仮定を明示する。
Provider固有の年齢区分変換はAdapterに閉じ、必要な時だけモデルが追加質問する。
参加者のアカウント権限`TripParticipant` (#399)とは別概念である。

#411の[TripParty導入記録](trip-party.md)で、同じ型・Request・仮定・converterを実装した。
`source=assumption`は既存constraintと同じくmodel/unconfirmedへのリンクを表し、ユーザー確定事実ではない。
Profile/legacy/assumptionは相互参照するassumptionId必須。却下後のpartyは元仮定を参照できず、
同じProposalで削除または別値へ置換する。名前や生年月日、Provider年齢区分は保持しない。

## 4. 計画・旅行実行の状態 (#383)

#383の導入範囲・Clock評価の精度・確認境界・legacy mappingは[状態導入記録](trip-state.md)を参照する。
ready認定は#402の[Trip Feasibility](trip-feasibility.md)で変更後TripをApplicationが検証する。
completedは明示確認のみとする。writer gateは解除しない。

planningStateとlifecycleStateは**Tripにのみ保存**する。TripRequest、ConversationSession、
AgentDecision、Viewer時計へ複写して独立更新しない。

| 状態 | 意味 | 更新の根拠 |
| --- | --- | --- |
| inspiration | 方向性が曖昧 | 旅行対象作成、方向性の見直し |
| candidate_discovery / candidate_selection | 候補探索/比較中 | 検証された提案・候補集合の提示や利用者操作 |
| itinerary_draft | 仮旅程を採用した状態、未確定可 | 候補選択/直接入力に対するdraft採用 |
| itinerary_refinement | 採用旅程の詳細化中 | itemや要求の編集 |
| ready | 主要な予定が成立する | #402の検証結果。未知を全件成功としない。未予約は別表示 |
| pre_trip / in_trip / completed / cancelled | 旅行前/実行中/終了/中止 | 実時間・日程・item実行状態または明示操作を検証 |

フェーズ順は固定しない。具体条件が揃えばdraftから始められ、旅行中のrefinementも可能。
readyは予約済みを意味せず、draftの保存に全項目確定を要求しない。不正構造は保存不可だが、
不足/外部情報unknownのdraftは保存できる。hard違反はreadyへ進めない。
#402ではissue code別policyでreadyを検証し、selected Stayのday精度等の情報的unknownは表示したまま許容する。readyは全件確認済みではない。保存済みreadyの読み取りは拒否せず、
派生評価が後で変わってもplanningStateを自動変更しない。詳細はADR 0056を参照する。

実時間は注入したClock、日付は対象item.scheduleのtimezoneを使う。Trip全体の開始/終了は
itemsから導出し、地域・timezone・日程が不足すればunknownとする。Viewerのシミュレーター時計を使わない。
過去日程を翌年へ動かさない。日程だけから「本人が訪問済み」と推測しない。
時刻からの`past/current/upcoming/unknown`は派生評価で、itemの`done`等の実績と別物。
開始/終了が確定したTripの日付到来によるlifecycle更新はApplicationが行い、根拠とrevisionを残す。
終了日不明なら時刻だけでcompletedにしない。cancelled/archivedを時刻で復活させない。

AIは遷移案を出せるが状態enumを返しただけでは書込権限を得ない。Applicationが現在Tripとの
整合を検証する。stateをTool allowlistや固定質問順のキーにしない。#384のAsk + Progress、
#391のTTFIはこの状態の観測を利用し、別の進行Plannerを作らない。

## 5. 採用済みItineraryItem

```ts
interface ItineraryItemBase {
  id: string;
  title: string;
  schedule: ItinerarySchedule;
  executionStatus: "planned" | "done" | "skipped";
}
type ItineraryItem = TransportItineraryItem | StayItineraryItem | ActivityItineraryItem;

interface TransportItineraryItem extends ItineraryItemBase {
  type: "transport";
  detail: TransportDetail; // mode + selected/unresolved。両端はdetail（railはlegs）から投影
}
type StayItineraryItem = ItineraryItemBase & {
  type: "stay";
  selection:
    | { status: "unselected"; place?: PlaceSnapshot }
    | { status: "selected"; accommodation: AccommodationSnapshot };
};
interface ActivityItineraryItem extends ItineraryItemBase {
  type: "activity";
  category: "sightseeing" | "food" | "experience" | "event" | "shopping"
    | "relaxation" | "free-time" | "other";
  place?: PlaceSnapshot;
  experience?: ExperienceSnapshot;
}
```

- 配列順を意図した行程順とする。時刻順に無言で並べ替えない。free-timeにはplace不要。
- `options`、`journeys[]`、候補選択indexをTripへ入れない。selectedなstayでは独立した`place`を
  保存せず`accommodation.place`から取得する。宿の選択/置換は対象item IDを必須にする。
- 未選択宿/未検証移動はplaceholderとして採用できる。ただし予約済み・経路成立・監視可能を意味しない。
- executionStatusは明示操作等で更新し、AI本文や経過時刻だけでdoneにしない。
  予約を持つitemのremove/replaceは予約の扱いを確認する。完了済みitemを通常の再計画で消さない。

### TransportDetail (#385 / #413)

`mode`は `rail | air | bus | ferry | car | rental-car | taxi | ride-hail | walk | bicycle | other`。
全modeは`status: unresolved`を取れる。#413の非鉄道manualは`status: selected` + `provenance.type: manual`で
「採用した予定」と「Provider検証」を区別する。時刻はitem.scheduleのみ、検証済み経路とは呼ばない。railのselected detailは
`{ mode: "rail"; status: "selected"; journey: SelectedRailJourney }`とする。
このstatusは採用状態であり運行状態ではない。modeごとのselected detailは独立unionとし、
airへ列車番号やrailへ空港固有フィールドを混ぜない。air/ferry等の未連携Providerはmanualで扱える。
非鉄道selectedはmode、origin/destinationのPlaceSnapshot、manual/providerのprovenanceだけを持つ。
Provider採用は保存許諾を確認したidentity/selectedAt/durable sourcesを保持する。selectedは予約済みを意味しない。
詳細・候補ID採用・legacy noteのdeferred方針は[Transport導入記録](trip-transport.md)を参照する。
railのmanual selectedは作らず、未検証の鉄道は従来どおりunresolvedにする。
航空API追加/旧Amadeus復活は#413の前提ではない。

鉄道の時刻と識別子は既存Journey/Train Domainを再利用する。選択時には検索実行と候補IDを
Applicationで解決し、LLMが送った経路本体を採用しない。永続recordの型が合うだけでもverifiedにしない。
再読込/再使用時は必要な日付の時刻表と照合する。旧経路の証明が不足すれば未検証を明示して再検索する。

### 選択済み鉄道経路: SelectedRailJourney (#385)

**Tripに生の`JourneyRouteResult`を永続化しない。** 次の3層を区別する。

| 層 | 契約・所有者 | 含める情報 |
| --- | --- | --- |
| 検索結果 | `JourneyRouteResult`、Journey検索/Tool境界 | 比較候補と検索時の遅延反映情報。Trip保存型ではない |
| 採用済み計画 | `SelectedRailJourney`、Trip内のvalue object | 採用した列車・区間・scheduled時刻・乗換・検証元だけ |
| 現在の観測・影響 | `TrainOperation` / `TravelEvent` / `TripImpact` | 現在の遅延・運休・推定発着・乗換影響。Trip revisionと計画snapshotへ関連付ける |

以下は文書内の最小契約であり、実装は#385が`modules/trip/domain`へ置く。
既存Journey/Trainの識別子・時刻計算・乗換validationは再利用するが、検索応答型のalias、
`extends JourneyRouteResult`、`Omit`による除外型にはしない。保存可能なfieldを独立して列挙する。

```ts
interface SelectedRailJourney {
  serviceDate: LocalDate;          // 最初のlegの業務日付
  selectedAt: string;             // 採用日時、ISO8601-offset-instant
  legs: ScheduledRailLeg[];       // 1件以上、乗車順
  transfers: ScheduledRailTransfer[];
  provenance: {
    verifiedJourneyRef: string;   // 採用元候補を監査できる参照、単独では検証証拠にしない
    verifiedAt: string;           // 採用前に計画事実を検証した日時
    sources: ExternalSourceEvidence[];
    timetableInputs: Array<{
      sourceId: string;           // 時刻表の論理的な出所（秘密の取得URLではない）
      serviceDate: LocalDate;
      contentDigest: string;      // 照合した不変入力を識別するdigest
    }>;
    validationPolicyVersion: string;
    transferPace: TransferPace;   // 採用時の乗換検証条件
  };
}
interface ScheduledRailLeg {
  id: string;                     // snapshot内で一意
  serviceDate: LocalDate;         // 日跨ぎ/別業務日の列車を区別
  serviceUid: string;
  trainNumber: string;            // 表示/照合補助、番号だけで列車を結合しない
  origin: PlaceSnapshot;
  destination: PlaceSnapshot;
  originStopIndex: number;        // 出所時刻表の停車順で同駅再訪を区別
  destinationStopIndex: number;
  scheduledDeparture: ZonedInstant;
  scheduledArrival: ZonedInstant;
}
interface ScheduledRailTransfer {
  fromLegId: string;
  toLegId: string;
  minimumTransferMinutes: number; // 採用時にDomainが検証した計画上の必要時間
}
```

- 全体のorigin/destinationとscheduled departure/arrivalは最初/最後のlegから、乗換地点は
  前leg.destinationと次leg.originから得る。総所要時間・待ち時間・乗換数はscheduled値からderiveし、
  検索結果の補正済み集計をコピーしない。itemのorigin/destination/scheduleはこのprojectionと一致させる。
- `serviceDate + serviceUid`と時刻表出所・停車順で照合する。trainNumberや名前だけで再同定しない。
  provenanceはApplicationがverified candidateと入力データから付け、LLM提供値を信用しない。
  runtime Evidence IDのみで完結せず、検索実行内の候補参照が失効しても時刻表と選択区間を再検証できる。
- Domain変換はverified結果と出所時刻表からscheduled事実を照合して明示構築する。
  JSON化前の型指定や型assertionだけでは余分なfieldを落とせないため、spread/丸ごとコピーは禁止。
  Domain境界・API/保存DTOも同じallowlistを守り、未知fieldをTripへそのまま通さない。
- `delayMinutes`、`delayStatus`、`delaySampleCount`、`delayBasis`、realtime status、実測/推定の
  発着時刻・行先変更・現在位置・混雑は、legs、provenance、埋込raw payloadのいずれにも保存しない。
  scheduled値に補正済みの`departureTimeMinutes` / `arrivalTimeMinutes`を名前だけ替えて入れない。
  経由停車駅を後でsnapshotへ追加する場合もscheduled事実のみを明示した別fieldとする。
- 全legの出所・scheduled値・連続性とtransfersを検証する。遅延があって初めて成立する乗換を
  「計画上成立」として採用しない。採用時の検証は将来の運行や乗換を保証しない。
- 再読込・運行監視時は対象日の時刻表digest/識別子/停車順/時刻と現行のvalidation条件を再照合する。
  欠落・変更・失効の再検証結果や現在の影響は外部の評価/Impactで返す。採用snapshotを無言で更新せず、
  計画の変更は確認付きProposalとTrip revision更新を経る。独立Snapshot Repositoryは作らない。
- legacyの選択時刻・provenance・scheduled事実が不足すれば`selected`を偽造しない。
  原本を端末内の移行記録として保全し、Tripではunresolvedとして再検証・再採用を求める。
  delayを引き算してscheduled値を復元したり、移行日時を過去のselectedAt/verifiedAtにしない。

例えば計画09:00発に遅延10分がある場合、Tripにはscheduled 09:00だけを保存する。
現在の見込09:10と遅延10分は外部観測、乗換への影響はTripImpactであり、表示時に関連付ける。
#385はこの変換/保存境界と適合試験を所有し、#386は暦日時変換、#393/#394は外部観測との照合を担う。
新しい探索器や運行状態の別正本は作らない。

### Schedule (#386)

`LocalDate`は実在する`YYYY-MM-DD`、`ZonedInstant`は`{ at: ISO8601-offset-instant; timeZone: IANA-zone }`。

| type | フィールド | 検証・意味 |
| --- | --- | --- |
| fixed | `startAt: ZonedInstant`、任意`endAt: ZonedInstant` | 各endpointにoffset/zone。end >= start。終了未取得なら重複判定の一部はunknown |
| window | `earliestStart: ZonedInstant`、`latestEnd: ZonedInstant`、任意`durationMinutes` | latestEndは終了期限。幅がduration以上。曖昧な午後を勝手に固定14時へ変換しない |
| day | `date`、任意`endDate`、任意`timeZone` | 日付のみ、endDateはexclusive。宿の連泊はcheck-out dateまで。未取得zoneは推測しない |
| unscheduled | 追加の時刻なし | 未配置。0時・今日をデフォルトにしない |

durationは非負の有限整数。空き時間計算にend不明を0分として使わない。
日付rangeはTripRequestの要求、windowは1itemの配置可能範囲であり、同じものではない。
宿のcheck-in/out日付はAccommodationSnapshot、scheduleの宿泊日付はそのprojectionで整合を検証する。
営業時間/受付時間は外部観測、予約の確定時刻はReservation。これらを上書きするscheduleは不可。

鉄道の`serviceDate + route_time_minutes`を暦日時へ変換する。例えば業務日9/21の24:20は
9/22 00:20（Asia/Tokyo）であり、単なる`minutes % 1440`で日付を落とさない。
4時境界・日付別時刻表の既存契約を変更しない。timezone/offset整合、日跨ぎ、DSTの不存在・
重複ローカル時刻は#386のvalidation対象。曖昧なローカル時刻を無条件に特定instantへ補完しない。

#386で同じ`ItineraryItem.schedule`に実装した。詳細と移行の制限は[Schedule導入記録](trip-schedule.md)を参照する。
`at`の現地時刻・offsetは指定IANA zoneと一致させる。`Z`はUTC offsetとして検証し、
Tokyoの壁時計時刻との組合せを許可しない。異なる終了地域は`endAt.timeZone`で表し、
top-levelの並行`timeZone`/`endTimeZone`をfixed/windowへ追加しない。

## 6. Place / Offering / Snapshot / Reservation

### Place identity (#414、検索の同定修正は#377)

`PlaceRef`は`{ provider: string; providerPlaceId?: string; canonicalKey?: string }`。
provider IDはnamespace付きopaque値でありraw payloadではない。名前の一致だけで同一IDにしない。
`PlaceSnapshot`は`{ ref?: PlaceRef; name: string; address?: string; coordinate?: { longitude: number;
latitude: number }; area?: string; timeZone?: string; capturedAt?: string; sources: ExternalSourceEvidence[] }`。
座標は有限かつlongitude [-180,180]、latitude [-90,90]。手入力の名前のみも可、未検証として扱う。
検索結果のruntime IDと永続Place identityを混同せず、同名別地点の自動マージをしない。

保存時にProvider利用条件を確認したfieldのみ採用する。**選択操作だけで恒久保存の権利は得られない**。
ADR 0041のSearch Box結果の恒久保存禁止を撤回しない。保存可否未確認のraw検索値/写真/説明を
serverへ移さず、再取得または利用者入力の地点として別の出所を明示する。
Provider由来の値を`manual`へ付け替えるだけの回避は禁止。保存可能なIDもなければrefを省略し、
再同定が必要と記録する。既存LocalStorageの原本は無言で消さず、取込不可fieldを報告する。
保持条件・attribution・鮮度はAdapterが検証してからSnapshotに渡す。#414/#400が実装を所有する。

#414で同じ`PlaceRef`/`PlaceSnapshot`と許可リスト変換を導入した。
実装済み範囲とlegacyの部分変換・Activityへの引継ぎは[Place導入記録](trip-place-snapshot.md)を参照する。
Providerの保存許諾は型のvalidityとは別であり、検索結果やモデル提供のpermissionを信用しない。

### Offeringと採用時Snapshot (#400)

`AccommodationOffering`は外部検索の現在候補、`AccommodationSnapshot`は採用した当時の計画記録。
#400で同じselected stayのinline sliceを`modules/trip/domain/accommodation-snapshot.ts`へ統合した。
共通PlaceSnapshotとExternalSourceEvidenceを再利用し、`TripAccommodation`はlegacy reader/writerに限定する。
Snapshotは以下のfieldだけを持つ。#412の価格観測を同じ型へ追加し、Reservationは#398へ残す。

| 項目 | 内容 |
| --- | --- |
| 識別 | 必須`provider`/`providerItemId`は宿泊商品identity。必須`place: PlaceSnapshot`の施設identityとは別 |
| 採用 | 必須`selectedAt`、`checkInDate`/`checkOutDate`（実在日付、checkIn < checkOut） |
| 根拠 | 必須の非空`sources: ExternalSourceEvidence[]`。accommodation/observed、Providerとdurable sourceIdが商品identityに一致 |
| 参考価格 | optional `observedPrice: PriceObservation`。価格の明示保持許諾と観測時系列を検証した場合のみ |

`source.retrievedAt <= selectedAt <= candidate.validUntil`と、出所の有効期間がある場合はその範囲を採用時に検証する。
生の価格・空室・bookingUrl・画像・review・予約状態/reference・rawをSnapshotへ保存しない。
#412は許可された価格観測のみ保持する。現在価格/空室を恒久的な事実にしない。

新しい選択では純粋なOffering→Snapshot変換へ選択日時と許可された値を渡す。
検索時点が不明ならunknownのまま。`selectedAt`やmigration実行日時を`observedAt`へ偽装しない。
Provider再検索は別Observationを返し、選択Snapshotを無言で更新しない。
Offeringの空室/価格は検索時の観測であり、採用後の現在値を保証しない。宿の採用をbooked/not-bookedにしない。
宿の採用はcandidate ID→同Trip/task/期限→一意なOffering→商品Evidence/保持許諾→
別途解決した施設Place/保持許諾→allowlist Snapshot→Proposalとする。施設IDを商品IDから生成しない。
titleは中立な「宿泊」、宿名の正本はSnapshot.place.name。check-in/outから共通scheduleのday spanを投影する。
legacyは証拠不足のためaccommodationの有無によらずunselected＋warning/deferredとし、採用時刻を捏造しない。
導入範囲・preview・Context・試験は[宿泊Snapshot導入記録](trip-accommodation.md)を参照する。
`ExperienceSnapshot` (#410)も同じ選択時点・Place・価格・出典を使い、固有情報を失わずActivityへ投影する。
現在の#410実装はActivityのtitle/schedule/PlaceSnapshot（durable出典付き）までとし、
独立したExperienceSnapshot/価格観測/予約状態は先行追加しない。保持できない固有情報は候補側に残す。
全Provider共通の巨大Offering階層を新設しない。食事はRestaurant検索結果を同じPlace境界で採用する。

### Money (#412)

`Money = { amountMinor: number; currency: CurrencyCode }`。amountMinorは非負safe integer、通貨は
ISO 4217公式リストに基づく対応6通貨（JPY/EUR/CHF/USD/GBP/KWD）。JPYは1円=1、EURは1ユーロ=100。対応するminor unit情報を使い、
小数のbinary floatを乗算して丸める移行はしない。sumもsafe integer超過を拒否する。
`PriceObservation = { price: Money; observedAt: string; basis?: reference-minimum | selected-dates }`。
#412では観測日時を必須に具体化し、日時不明なら観測自体を作らずlegacy原値を保全する。
保持根拠はAccommodationSnapshotの既存sourcesとtrusted resolverを再利用する。
元通貨別subtotalを返し、JPY+EURを合計しない。為替表示を追加する場合だけ、原額・換算額・rate・
rate時点・sourceを別projectionへ置く。鉄道運賃を取得/推定して合計しない既存方針は維持する。
採用時価格はobservedAt <= source.retrievedAt <= selectedAtで検証する。実装と互換性の詳細は[Money導入記録](trip-money.md)を参照する。

### Reservation (#398)

#398の実装は[Reservation導入記録](trip-reservation.md)とADR 0055を参照する。独立resource、owner-scoped保存、
独立CAS、予約済みitem保護、非private read projectionを追加した。公開認証/writerは未有効。

独立aggregateとして`id`、`tripId`、任意`itineraryItemId`、`schemaVersion`、`revision`、
`kind: transport | accommodation | activity | restaurant | other`、
`status: unknown | not-booked | not-required | booked | cancelled`、
Provider参照、任意bookedAt/予約固定時刻を持つ。1itemに複数Reservation可。予約照合情報はprivateに保持する。
change-required/confirmationStatusは追加せず#402の派生評価へ残す。#398は予約管理URLを保持しない。
bookingUrlはOfferingの「予約先」であり、SnapshotにもReservationにも自動コピーしない。

未登録Reservationはunknownでありnot-bookedを推測しない。既存宿選択からbookedを作らない。
item削除/置換では予約を消さず、関連維持・detach・変更必要を確認する。ホテルを別施設へ置換した時に
旧予約を新ホテルの予約として自動再接続しない。予約取消はTripの時刻を変更しない。
Reservation更新とTrip更新は別revisionで、適用時は関連予約のrevision/固定時刻も再検証する。
チェックリスト/旅行中Contextは必要なstatusだけを読む。会話共有へ予約番号を漏らさない。

## 7. Candidate・意思決定・変更適用

`TravelCandidate`を比較前候補の唯一の型として発展させる (#385)。地域の方向性だけの候補は
verified rail journeyを必須にしない。宿/経路/体験の候補集合はTripの外で保持する。
候補にはid、検索/提示時点、根拠、対象Trip/request revisionとの対応を持たせる。
`TravelCandidateAssessment`は#406が所有し、地理適合・制約充足・移動負担・天候・不明を表す。
実装は[候補Assessment](candidate-assessment.md)。取得済み事実のread-only評価であり、Tripへ保存しない。
検索修正#366やClaim検証#376で別の候補モデルを作らない。

採用は`candidate ID → Applicationが候補を解決 → TripUpdateProposal → 検証/確認 → TripPatch`。
候補変更はreplaceであり、今のTripへ候補Bを勝手に混ぜない。却下ならTrip不変。
候補の期限切れ、別Trip、別revision、別実行の一時検索IDは再検証し、事実として流用しない。
未選択候補を復元したい場合は権利/鮮度付きの候補キャッシュを使い、Tripへ隠して保存しない。

`TripUpdateProposal`は`tripId`、`baseRevision`、`proposalId`、`summary`、`patches: TripPatch[]`を持つ。
既存add/replace/remove/move/metadataの意味を継承し、要求/状態更新もtyped Patchとして追加する。
自由JSON PatchでownerId、schemaVersion、revision、予約状態を編集させない。
itemの安定IDを保持、存在しないreplace/remove/moveと重複addはerror、複数Patchは全件検証して原子的に適用。
model生成の外部事実はEvidence/Claim検証を通し、経路は検証済み結果からだけ作る。

Applicationは認可→入力検証→根拠/予約/対象revisionの検証→Domain validate/apply→conditional saveを行う。
UIの明示操作とAI提案は同じ適用経路を使う。モデルは承認主体でも永続状態の正本でもない。
Agent ContextはTrip/Request・比較候補・外部事実・Profile・判断結果を別fieldでboundedに投影する。
永続IDをモデルへ必要以上に渡さず、操作対象はtask内のopaque参照からApplicationが解決する。
現在のEvidence/Claim validation、limits、timeoutを置換しない。

## 8. 永続化・API・version・会話

| 境界 | versionと正本 | 担当 |
| --- | --- | --- |
| Domain | `Trip.schemaVersion = 2`。item/request独立versionを乱立させない | #385が骨格、#389が更新契約 |
| 更新 | `revision`は初回0、採用更新成功時に1増加。失敗/同一retryでは増えない | #389 |
| wire | `trip-api-v1` envelope。Domain schemaと別version、unknown versionは明示拒否 | #388 |
| DB | Adapter recordの`storageVersion`。PK/SK/owner index/TTLはDomainへ出さない | #388 |
| Browser | 移行元legacyキーとV2キャッシュenvelopeを別管理。会話store v3はTrip V2ではない | #388 |

最終TripRepository portはcreate/get/list/update/archive/deleteを所有し、Backend Applicationが
認証主体から解決した所有者scopeを毎回渡す。ownerIdをclient/LLMの入力で信用しない。
RepositoryはDomain値を返し、DTO変換は境界で行う。DB属性をそのままHTTPへ返さない。
共有は#399の[TripParticipant/ShareGrant認可](trip-sharing.md)。owner基盤を未認証公開してはいけない。
Participantは内部owner namespaceへの認可projectionであり、Trip本体のowner PKや単一正本を変更しない。
現在の配信保護をユーザー単位のTrip認可が完成した証拠とみなさない。認証未整備ならprivate/gatedのままとする。

更新commandは`tripId, expectedRevision, mutationId, patches`。mutationIdはclient/Applicationが
1操作に固定し再送でも維持する。`(principal, tripId, mutationId)`とpayload digestを対応付け、
同一payloadは元の成功結果を返す。別payloadで同IDは拒否する。古いexpectedRevisionは409 conflict。
DynamoDB等ではTrip書込・revision条件・重複操作記録を原子的に扱い、read→無条件putにしない。
Conflict時は最新Tripを取得し再提案/再確認へ戻す。自動的なlast-write-winsやAIの意味的mergeは禁止。
create/初回legacy importでのみrevisionを0にする。既存V2のschema更新でもrevisionを0へ戻さず、
永続値を書き換える場合はcurrent revision条件を検証して1増加する。read-time projectionは増加させない。
createdAtはV2リソースの作成日時であり、legacyの作成日時を捏造しない。旧updatedAt等は移行記録へ残す。
エラーはnot-found/forbidden/conflict/invalid-input/unsupported-version/unavailableを区別し、
未認可時にTripの存在や本文を漏らさない。契約のsize/item上限は#388で設定・試験し、超過時に切り捨てない。

**#388と#389のリリース境界（最新#388指示 / ADR 0053）:** #388はprincipal必須の保存/取込基盤、
非CAS replaceとread/preview sourceまで。expectedRevision・baseRevision・mutationId・CAS・idempotencyは
予約fieldも含め先行追加せず、#389が同じRepository/Proposalへ統合する。公開Trip routeは認証Adapter未導入のため閉じる。
BrowserのV2書込への切替は認証境界と両Issue完了をgateとし、無条件更新を先に公開しない。
現段階の契約・容量上限・原本保持・ACは[server保存基盤](trip-server-persistence.md)を参照する。

1ConversationSessionは`tripId?`を最大1つ参照し、1Tripは0〜複数Conversationから参照できる。
別の旅を話すならdetach/attachまたは新規会話を明示する。会話内の古い応答は履歴のsnapshotであり、
現在のTripへ自動適用しない。会話削除/履歴evictionはTripを削除しない。
Trip削除は所有者の別操作で関連予約/Watch/参照を扱い、参照先がなくなった会話も失敗せず履歴表示する。
会話・UserProfile・TravelMemoryをTripとともに丸ごとserverへアップロードしない。

## 9. 段階migrationとownership

### 共通ルール

移行関数はlegacy入力を変更しないpure conversion、実行・書込・原本保全・retryはApplication/Adapter。
変換の最終出力は1つのTrip V2。各IssueがV3/V4や一時中間保存形式を増やさない。
Domainの拡張は依存順にmainへ入れられるが、**全変換が揃うまでV2 writer/importを有効化しない**。
その間のlegacy本番writerは現行形式を維持し、V2と同時に正本としてdual-writeしない。
新APIのcreateはV2のみ。Browser切替後にlegacy形式で新規保存しない。

### 移行手順

1. **設計のみ (#415)**: 本契約/ADR/担当表を採用。local data・wire・runtimeは変更しない。
2. **旧不整合とコア (#404/#405 → #385)**: 既存reader/安全Patchを修正。#385がTrip/itemsの骨格と
   legacy→V2純粋変換の入口を1か所に用意する。schemaVersion 2/revision 0を予約。
   #383の状態、#387のRequestと以後のvalue objectを同じ骨格へ追加する。機能は個別PR、writerはgate下。
3. **変換完成 (#383/#387/#411/#414/#386/#413/#410/#403/#400/#412)**:
   下表の担当が同一converterへfield mappingを追加。#400の価格最終形は#412と結合する。
   pure fixtureでlegacy・不正・unknownを検証。UI/Evalは必要な担当PRで段階対応。
4. **保存基盤 (#388 → #389)**: #388がTrip API/owner scope/取込回復metadata、
   #389がCAS/idempotencyと全更新のrevision/proposal/再送・競合処理を完成。server移行に別のDomain変換を作らない。
5. **ユーザー単位の切替 (#388のrollout)**: 移行内容を提示し認証された所有者として取込。
   下記の確認完了後だけそのTripの正本をserverへ切り替える。失敗Tripはlegacyのまま残る。
   V2 writerを開始したTripはold writerへ戻さない。会話削除cascadeを同時に停止する。
6. **読み取り互換の終了 (#388が管理)**: 移行結果/未対応形式を確認し、明示されたcleanupまで
   旧rawと取込mappingを保持。旧キー・history decoderの撤去は別のレビュー可能なPRで行う。
   実行に必要なlegacy書込型は撤去、保存履歴のdecode専用DTOはAdapterへ限定して残せる。

#382の順序は価値提供の順序で、型を同時編集してよいという意味ではない。
#383は#385の最小Trip骨格後に実装し、TripContextへ別の永続state machineを先行追加しない。
#384は#387のassumption契約を使用する。#388/#389の境界を上記の安全なrollout gateで補う。

### LocalStorage取込プロトコル (#388)

以下は#389まで含めた最終rollout契約。#388単独の実装は[server保存基盤](trip-server-persistence.md)の
固定UUID/read-back/原本保持までで、import ID/digestによるserver create-onceや複数tabの保証は#389に残す。
API公開・本番import UI・writerは未有効である。

- 入力は単一`transitforge.trip-plan.v1`、`transitforge.trip-plans.v2`の各session record、
  session v1/v2/v3のID対応と必要な既存構造化TripContext。既存migrationを連続実行して元キーを
  消してからserverへ送る方式にしない。**最初に元のJSONを保全**し、失敗時に上書きしない。
- `tripPlan.id`は旧コード生成値でありグローバル一意と仮定しない。移行元installation ID +
  source key + session ID（単一旧形式は専用scope）でsource identityを作り、元内容のdigestを記録する。
  1旧record→1新Trip UUIDのmappingと固定import IDを保全し、再試行でUUIDを作り直さない。
  名前/同じ旧plan IDだけで異なるrecordを統合しない。曖昧な会話へのattachは確認する。
- rawをparseしrecord単位に変換。結果は成功、要確認（未検証経路/出所不明条件等）、不正/未対応に分類。
  不正な1recordで他Tripを落とさず、破棄もしない。将来schemaを現在型へ押し潰さない。
- TripPlanがまだない相談は会話履歴を残す。希望だけの会話を無断でTrip化しない。
  利用者がその相談を旅行として引き継ぐ場合は空itemsのTripを作り、既存構造化条件を
  #387の出所/仮定付き変換でRequestへ取り込む。会話本文をアップロードして移行し直さない。
- 元dataの出所/保存許諾を確認し、送信可なTrip DTOだけをアップロード。raw Profile、会話本文、
  認証値、booking reference、制限されたProvider payloadは取込DTOに含めない。
- Serverはowner scope + import ID + digestでcreate-onceを保証する。同ID同digestは同じTrip/revisionを返し、
  同ID別digestはconflict。clientは成功応答とserverのGETによる確認後にmappingを確定する。
  success応答を失っても再送/照会で復元できる。
- 取込中は該当recordの編集を止めるかdigest変更を検出して切替を中断する。他tab/旧clientの
  legacy書込が検出されたら差分を要確認とし、serverを自動上書き/重複importしない。
- server保存成功後に会話attachやcache更新が失敗しても、mappingからattachを再試行できる。
  LocalStorage quota/errorなら未完了として表示し、元recordを消さない。server成功とlocal完了を混同しない。
- Offlineの未送信操作はbaseRevision/mutationId付きのpending proposalでありserverの代わりの正本ではない。
  再接続時のconflictは再確認する。認証不可時は既存localを読めるが、未認証server保存へ迂回しない。
- 旧rawは権限限定の端末内回復用としGit/ログへ出さない。期間だけで未移行データを自動削除しない。
  V2移行後のアプリrollbackはV2を読める互換releaseへ限定し、旧形式へダウングレード保存しない。

### Migration matrix

| Current | V2 / 変換規則 | 一次担当 / 完了gate |
| --- | --- | --- |
| TravelPlan / ViewerAgentTravelPlan alias | 検索候補DTOへ縮小、採用はProposalからTripへ。歴史的応答はdecode専用 | #385、全producer/UI移行後に新規生成撤去 |
| TripPlan / TripPlanItem | Trip / ItineraryItem、旧idはmapping、item ID/順序は維持 | #385、writer切替は#388/#389 |
| TripPlan.version / store.version | Trip.schemaVersion=2、revision=0。store v2とは別 | #389、骨格の予約は#385 |
| TripJourneyPlan.journeys | 明示選択の証拠がある1件だけselected。複数/選択不明は候補へ退避+unresolved。先頭を自動採用しない | #385。旧1件も検証情報不十分なら再検証 |
| JourneyRouteResult / Journeyのdelay付加値 | 明示選択・計画検証の証拠が揃うものだけSelectedRailJourneyへallowlist変換。生の検索結果は保存禁止。不足は原本保全+unresolved | #385、#386の暦日時変換と#393以降の観測へ接続 |
| Stay.options / accommodation | optionsをTripへコピーしない。明示accommodationも証拠不足ならunselected＋warning/deferred。旧原本を保持 | #385で分離、#400で契約完成 |
| TripAccommodation | 自動selected化なし。利用者の目的地名と日程だけ未選択予定へ保持。宿名/住所等をmanualへ偽装しない | #400 |
| TripContext.planningStage | Trip.planningState、legacy inspirationはinspiration。planning+itemsはdraft、itemsなしはdiscovery。readyや訪問済みを推定しない | #383 |
| TripContext.destinationWish/startDate/endDate/stayNights/時刻/興味/回避/交通条件 | TripRequestのtyped constraint。出所不明はlegacy+未確認assumption、Profileを本人の確定発言にしない | #387 |
| TripContext.pace/relativeDistancePreference/adventureIntensity/avoidedRisks | 同じTripRequestへ。相対比較の対象不明は未解決。安全制約は維持 | #387 |
| TripContextとTripPlanの競合した日程 | 要求と採用itemを別に保持、要確認。timestampだけでどちらかを消さない | #387 / #386 |
| conditions.adults/children / companions | TripRequest.party。子ども人数分の年齢不明entry。旧defaultの出所不明を確定扱いしない | #411 |
| conditions.considerations | source=legacyのexperience等、意味を確定できなければ未確認assumption | #387 |
| manual date / sightseeing date / stay日付 / rail業務日付 | day / unscheduled / day span / 検証済みfixed。不正日は隔離し自動繰上げしない | #386 |
| movement/MovementMode | transport/detail union。既存otherはother、勝手にairへ推測しない | #413 |
| sightseeing / ExperienceOffering | activity:sightseeing / activity:experience。restaurant→food、自由時間はplaceなし | #410 |
| place.name/provider/placeId/coordinate tuple | PlaceSnapshot/Ref。longitude/latitude明示、範囲外は拒否して原本保全 | #414。旧wikipedia復元の先行修正は#404 |
| destination | summaryDestinationへ表示補助として保存（1〜200文字、空白のみ不可）。不正なら警告と原本保持。Request/itemsは生成しない。訪問地/宿泊地projectionは採用済みitemsから | #403 |
| TravelPrice.amount JPY | Money.amountMinor、JPY整数は同値。価格時点不明はunknown | #412 |
| TripPlanPatch/UpdateProposal | TripPatch/TripUpdateProposal、既存操作を安全に継承、baseRevision/mutationIdを導入 | #405が適用の整合、#389がrevision |
| plansBySessionId / legacy単一キー | 上記create-once import→tripIdでserver保存。旧raw/復旧mappingを保持 | #388 |
| Session.tripPlanId / session削除cascade | tripIdへmapping、会話削除とTrip削除を分離 | #388 |
| history内TripContext/TravelPlan/TripPlanUpdate | legacy DTOとして読み取りのみ、最新Tripを復元上書きしない | #387が要求、#385が応答、#388がreader整理 |
| bookingUrl/availability | bookedの証拠ではない。新Reservationなしならunknown | #398 |
| TravelAlert | [HazardAlert](hazard-alert.md)へ内部移行済み。既存wireを維持しNotificationへ転用しない | #401 |
| TravelRecheckRequest（端末内明示予約） | server recheck導入時も同意/対象/期限を確認し、未知対象を捨てず保留 | #409 |

### 後続機能の境界（#415には実装しない）

| Issue | この契約の利用点・残す責務 |
| --- | --- |
| #383 / #384 / #391 | 状態更新、Ask + Progress、TTFC/TTFIの実装・評価。新しい固定Plannerを作らない |
| #385 / #386 / #387 | コア分離・schedule・今回要求、対応converterとproducerの変更 |
| #410 / #411 / #413 / #414 / #403 / #400 / #412 | 上記の各value object/mapper/UI。隣の型を別名で複製しない |
| #388 / #389 | Repository/API/取込/CASと全Proposalのrevision統合。#415はDTOやDBを実装しない |
| #402 | feasibility、保存/ready時の検証、unknown/違反のreason code。schema validationと混同しない |
| #398 / #392 / #399 | 予約aggregate、[派生Readinessと独立準備リスト](trip-readiness.md)、参加者/共有認可。TripPartyはアクセス権ではない |
| #390 | 同じTripとProposalを表示・編集するUI。別のUI Trip正本を作らない |
| #406 | 候補のAssessment、partial resultとEvidence。#366/#376と別検索/grounding基盤を作らない |
| #393 / #407 | Watch/Event/Impact契約、TripChanged→Watch再生成の配送。Streams/outbox選定は#407 |
| #394 / #401 / #408 | 鉄道影響、公的Hazard、天候影響。unknownを安全値として埋めない |
| #409 / #395 | 時刻起点の再確認、通知永続化/dedupe/delivery。予約・Trip revisionとは別状態 |
| #396 / #397 | bounded旅行中Contextと残りだけのreplan。完了済み/予約/固定制約の保護、確認付きPatch |

## 10. 設計の検証・後続PRのゲート

#415は挙動を変更しないためmigrationテストを通過済みとは主張しない。後続の必須適合ケースを定義する。

| 分類 | 必須ケース | 担当 |
| --- | --- | --- |
| legacy | 単一v1/store v2、mode省略rail、wikipedia、複数経路/宿、条件欠落、古い履歴、ID衝突 | #404/#385/#387/#388 |
| invalid | 重複item ID、未知schema/type、壊れたJSON、無効暦日、不正座標/価格/人数、不正Patch列 | #405と各value object担当 |
| temporal | 4時境界、24:20、日跨ぎ、DST、時刻不明、過去Trip、シミュレーター時計非適用 | #383/#386 |
| unknown | 存在しない時刻表、古い運行/天候、選択時刻不明、子の年齢不明、保存許諾不明 | #385/#400/#411/#414/#402 |
| rail snapshot | 検索結果に遅延/status/補正時刻/未知fieldがあっても保存DTOへ混入しない。計画09:00/予測09:10の分離、delay前提の乗換拒否、provenance欠落はunresolved | #385 |
| rail revalidation | 別業務日の同serviceUid、同駅再訪、時刻表digest変更/欠落、validator変更を検出。再観測でTrip snapshot/revisionは変更しない | #385/#386/#393/#394 |
| duplicate/retry | 同じimport/同じupdate二重送信、同ID別payload、古いbaseRevision、応答消失 | #388/#389 |
| partial failure | 1件不正でも他Tripは取込可、server成功local失敗、quota、offline、認証切れ、別tab旧書込 | #388 |
| compatibility | 旧会話は表示可能、V2の採用状態を旧応答で上書きしない、V2 writer後に旧形式書込しない | #385/#387/#388 |
| safety | 未認証/別owner拒否、予約削除/detach、固定予定保護、未検証経路を確定しない、ログ秘匿 | #388/#389/#398/#399/#402 |

Architecture checkerの現行規則はDomain→外部SDK/Browser禁止、Backendのcontracts/ports/usecases/
adaptersの依存方向を既に扱う。本PRでは新importがなく規則の緩和・例外追加は不要。
ただし`modules`の相対importやworkspace経由の実行層越境、TypeScript `Storage`型、意味上の二重正本までは
現checker単独で保証できない。#388でPort/Adapter追加時の負例テストを足し、レビューではこの所有表も使う。
checkerの成功だけを設計完了や認可保証とはしない。

### #415 Acceptance Criteriaの自己レビュー

| AC | 確認先 | 判定 |
| --- | --- | --- |
| 後続が最終型を判断できる | §2–§8の契約・invariant、§9の担当表 | 設計として充足 |
| TravelPlan/TripPlanどちらが将来正本か明確 | §1/§3: どちらでもなくTripへ一本化、旧型の撤去gateあり | 設計として充足 |
| Candidate/Itinerary/Reservation/Realtimeの境界 | §2のaggregate図、§5–§7、§9 | 設計として充足 |
| Bedrock判断と永続状態を分離 | §3/§4/§7、Decisionを直接保存しない | 設計として充足 |
| big-bang前提でない | §9の個別PR・writer gate・pure converter単一化 | 設計として充足 |
| LocalStorage→server順序が明確 | §8/§9のversion・取込・失敗/rollback・担当 | 設計として充足 |

親#382と子Issueは未完了のまま残す。本設計PRのclosing対象は#415のみ。

#396の[旅行中Context導入](in-trip-context.md)では、同じTripを変更せず現在/次予定・Impact・通知・予約を
boundedに投影する。#397の再計画とは分離し、認証gateとplanned/realtimeの正本境界を維持する。
