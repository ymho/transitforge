# TripRequest / PlanAssumption導入 (#387)

正本設計は[#382](https://github.com/ymho/transitforge/issues/382)、[#415](https://github.com/ymho/transitforge/issues/415)、
[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)、[最終契約](trip-lifecycle.md)。
本書は#385/#414/#386の同じTripへ追加した実装範囲を記録する。**V2 writerは未有効**であり、
現行画面のLocalStorage保存やlegacy会話フローを今回V2へ切り替えたわけではない。

## Before / Afterと責務

| 現状 | #387での定義 / 実装 | 後続 |
| --- | --- | --- |
| legacy TripContextに今回条件、嗜好、planningStageが混在 | 同一Tripの`request`だけをV2の今回条件正本とする。独立Repository/Context正本は作らない | #383がstate、#388/#389が保存切替 |
| Profile/履歴/AgentDecisionの解釈から毎回条件を組み立てる | V2 Contextは保存Request、effective hard/soft、未確認仮定、Profile、当該ターンDecisionを分離 | #384が会話・Ask + Progressの接続 |
| 仮置きの出所や却下状態が型で追跡できない | constraintのsource/strengthとassumptionのsource/status/affectsを独立保持 | #390が本格UI |
| 旧considerationsは自由文、旧fieldに強さ/出所がない | 単一converterで意味が確実な値だけ移行し、legacy + unconfirmedで保持する | 移行原本/取込履歴は#388 |
| 採用時刻と日付希望を取り違え得る | Request変更はitem.scheduleを変更しない。純粋な三値評価で不一致/不明を返す | #402が全体成立性 |

Domainは`modules/trip/domain`、Proposal生成は`frontend/src/usecases/trip-plan`、
表示projectionは`frontend/src/presentation/trip-plan`、Agentの読み取りprojectionは既存Agent Contextに置く。
新しい自然言語router、質問順序、Planner、Provider、保存機構は追加しない。

## 正本とtyped requirement

`Trip.request: TripRequest`は必須。新規の空Requestは「条件なし/未把握」であり、日帰り・人数・日付等を補完しない。
`goal?`、`constraints[]`、`assumptions[]`だけを導入する。`party`は#411が同じ型へ追加する。
schemaVersionは2のまま、revision/updatedAt更新は#389のwriterまで行わない。
V2の本番データはまだないため、旧データ移行は既存legacy converter経由に限定する。

constraintは一意ID、`hard | soft`、`user | profile | assumption | legacy`、任意assumptionId、
trip/item scope、typed `TripRequirement`を持つ。item scopeは実在IDを参照する。

| discriminator | 実装 |
| --- | --- |
| origin / destinations | #414 PlaceSnapshot、destinationsは配列とfixed/flexible順序。希望は採用itemと別 |
| dates | #386 LocalDateのinclusive earliest/latest、任意end/timeZone。exactは両端同日、rangeはそのまま |
| duration | nights/days、minimum/maximum整数。0泊可、daysは1以上。不明はfield/requirement未設定 |
| depart_after / arrive_by | #386 ZonedInstant + #414 PlaceSnapshot。IANA/offset検証、Placeにzoneがあれば一致必須 |
| mobility | 既存JourneySearchPreferences、JourneySearchRequestの列車条件、MovementModeを再利用。maxTravelMinutes、modes/excludedModes/requiredModes、carAvailable |
| experience | prefer/must/avoid、text、任意TravelPreference/weight。文章から機械的な成立を捏造しない |
| pace | 0〜1 |
| relative_distance | 既存nearer/farther + 比較対象candidate IDs。対象不明ならtypedな絶対距離へ変換しない |
| adventure | 既存intensity/AdventureRisk。安全policy自体は変更しない |

自由JSON DSL、unknown field、raw Provider値、無効日付/zone/Place、非有限数を拒否する。
Provider Placeの保存可否は引き続き信頼されたAdapterと`createPlaceSnapshot`の保持allowlistが所有する。
`validateTripRequest`の構造validationやモデルのsource宣言だけでは保存許諾/Evidenceが成立しない。
Moneyは#412が最終型を追加するまでbudget discriminatorを拒否する。暫定金額型を作らない。

## 仮定、Profile、原子的な変更

- hard/softは強さ、confirmed/unconfirmed/rejectedは仮定の状態であり別軸。hardでも未確認にできる。
- source=assumptionは既存assumption必須。constraint.assumptionIdとassumption.affects.constraintIdは相互参照で検証する。
  Profile/legacyの仮定リンクは同じ出所を要求し、user constraintに仮定リンクを付けて偽装しない。
- `effectiveTripConstraints`は却下済みを除外し、未確認はassumptionId付きで返す。「有効」は「確定」ではない。
  未確認hardは評価結果もunknown。confirmed後もsource/strengthは変更せず、確認の履歴を保持する。
- 同じscope/種類の明示user条件をprofileより優先する。mobilityは同じ属性（mode/列車条件の必須・除外・許可は同一属性）だけを置換し、
  他の属性は残す。experienceは同じTravelPreferenceまたは同一textの明示条件を優先する。
  異なる文章同士の意味上の競合をregexで解釈しない。
- `proposeProfilePreference`はpace/carAvailable/maxTravelMinutes/interestを個別選択しsource=profileでProposal化する。
  任意のprofile由来unconfirmed assumptionを付けられる。Profile全体や自宅情報を無条件コピーしない。
- `proposeTripRequestUpdate`はメモリ上のRequest変更案を作る。信頼したApplicationがactorを決める。
  model経路の新規解釈はmodel-source unconfirmed assumptionに限定し、既知要求の書換え・削除・確認を許可しない。
  新しい場所は未検証の名称希望までとし、モデルが新しいProvider Evidence/座標を作ることを拒否する。
  保存済みPlaceの再利用は可能。新しいProvider snapshotは信頼された解決・明示採用の境界を通す。
  user経路は明示採用用であり、LLMがactor=userを自己申告するAPIではない。
- `proposeAssumptionDecision`は利用者のconfirm/rejectを既存TripUpdateProposalへ接続する。
  未確認→確認/却下、同じ結果の再送は冪等。確定後の反対操作は新たな明示Request変更を必要とする。
  itemのschedule/place/selectionへ影響する仮定の却下は、対応fieldの未解決化を明示replaceとして同時に要求する。
  自動でitemを消したり時刻を変えたりしない。代替の採用は別の明示Proposalで行う。
  影響していないitemのrepairは拒否する。party確認は#411まで未対応であり黙って成功させない。
- `applyTripProposal`に同じrequest patchを追加。最終Requestと全itemをまとめてvalidateし、
  不正なら何も返さず元Tripを変更しない。ID・schemaVersion・revision・createdAtは保持する。
  Requestとscheduleが異なること自体はRequestを破棄する理由ではない。評価で不一致を示し、再計画へ渡す。
- `planAssumptionViews`は「⚠ 仮置き」/確認済み/却下済みとconfirm/reject actionを返す。
  UIがtextとして描画してactionをApplicationへ渡す最小境界で、現行DOMへのwriter配線は#390以降。

## TripContext全fieldの移行先

| legacy field | V2正本 / 保持する意味 | 今回のmapping / 未確認時 |
| --- | --- | --- |
| planningStage | Tripのplanning/lifecycle state | #383へ警告。Requestへ入れない、固定Tool順序にしない |
| destinationWish | Request.destinations requirement | 名前だけの未検証希望、sources=[]。採用itemやverified Placeにしない |
| startDate / endDate | Request.dates range | 有効なexactのみ両端同日。過去年を変えない。不正endは警告して有効startを維持 |
| stayNights | Request.duration | 非負整数のexact。欠落は0にしない |
| outboundDepartureTimeMinutes / returnArrivalTimeMinutes | Request.depart_after / arrive_by | legacyには信頼できる場所・civil date・zoneの組合せがないため今回は仮定文と警告。instantを捏造しない |
| companions | TripRequest.party | #411へ警告、普段のProfile.companionsと区別 |
| interests | Request.experience prefer | 既存TravelPreference + 有効weightを保持。普段の値はProfile.preferencesに残る |
| avoidances | Request.experience avoid | 非空文字列。自由文なので充足の機械的証明はunknown |
| pace | Request.pace | 0〜1。普段のProfile.travelStyle.paceは別のまま |
| maximumTravelMinutes | Request.mobility | 非負整数。nullは既知上限なしで、0へ変更しない |
| carAvailable | Request.mobility | boolean。普段のProfile.home.carAvailableをuser発言へ偽装しない |
| relativeDistancePreference | Request.relative_distance | legacyに比較candidate IDがないので未確認文+警告 |
| adventureIntensity / avoidedRisks | Request.adventure | 既存enum。intensity不明なら補完せずdefer。安全policyを緩和しない |

Profile自体のhome、普段の同行者、travelStyle、preferences、transportは別リソースに残る。
その一部を今回使う操作と、Profileの更新操作は別である。旧TripContext内には新たに正本fieldを追加しない。
AgentDecisionの解釈・次action・質問要否・比較/再計画理由は会話/実行Contextだけに残し、Requestへ自動保存しない。
V2移行後はTripContextへの今回条件の書込と旧履歴による正本復元を廃止する。現行legacy producerの撤去はwriter gateと同時に行う。

## 単一converterとmigration限界

`convertLegacyTripPlan(plan, identity, { tripContext, placeRetentionByItemId })`の同じ入口を拡張する。
旧readerで日付補正/clamp/defaultを加える前の構造化legacy値を受け取り、自然言語は再parseしない。
意味が明らかな値もsource=legacy、soft + unconfirmed assumptionとして移す。softは出所不明値を
必須条件として強制しないための初期取扱いであり、元ユーザーがsoftと言った証拠ではない。仮定文に必須度未確認を明記する。
`conditions.considerations`は意味を推測しないunconfirmed legacy assumption、adults/childrenは#411へ残す。
不正/未知fieldはfield単位のwarning。新しいmigration日時をselectedAtや要求時刻に利用しない。
同じ入力/引数は同じ出力、原本不変、`requiresLegacyRetention: true`。欠落/不正値を補正せず原本を保全する。
Profile由来かuser由来か復元できない値は、その事実をlegacyとして残す。

## 最小hard constraint評価

`evaluateTripHardConstraints(trip)`は純粋な計画比較で、effective hardごとに
`satisfied | violated | unknown`とreasonCodeを返す。ProposalのプレビューTripにも利用できる。
Trip/items/Requestを先にvalidateし、評価そのものは更新しない。

- datesは採用順の先頭開始/末尾終了とrangeを比較。windowが要求範囲に跨るとunknown、完全に範囲外はviolated。
  日付だけのscheduleのzoneを補完しない。指定zoneへ変換可能なinstantだけ暦日変換する。
- arrive_by/depart_afterはPlaceRefで同定できたrail endpointのscheduled instantだけ比較する。
  名前だけの自宅・駅、未採用移動、最後の徒歩等が未確認ならunknown。現行の名前のみの鉄道駅snapshotも
  別地点identityが確認できなければunknownであり、駅名一致だけの同一視はしない。
- maxTransfers/maxTravelMinutesは選択済みrailの計画値。Trip scopeは各移動に適用し、往復合計とはしない。
  item scopeはその移動だけ。遅延は計算しない。mode/列車番号/UIDの必須・除外は保持済み事実だけで比較する。
- serviceType/trainName、未解決の交通手段、自然言語experience、相対距離、車の利用可能性等、
  現snapshotが証明しないものはunknown。transferPaceが異なる場合も再検証なしに成功としない。
  一部itemだけuser条件で上書きされたtrip-wide Profile要求も、合成評価を推測せずunknownとし#402へ渡す。
- 却下した仮定の条件は評価対象外、未確認のhardはunknown。空結果は「全旅程成立」ではない。
  成立性エンジン/検索Plannerを新設せず、#402/#406へこの境界を渡す。

## Agent Context / 評価

既存`createAgentContextSnapshot`のV2 projectionにRequestを追加する。
`buildAgentDecisionContext`は`persistedTripRequest`、`tripHardConstraints`、`tripSoftPreferences`、
`unconfirmedAssumptions`、`travelProfile`、任意`currentTurnDecision`を別fieldへ投影する。
Requestはreadonly正本の投影で、effective配列/仮定は同じRequestからbuilderがderiveする。呼出側から別の有効条件配列を受け取って正本と競合させない。
currentTurnDecisionは既存AgentDecisionSummaryであり永続化しない。
V2 Requestがある時は旧tripContextと履歴/解釈由来のlegacy条件を併用しない。legacyだけの実行経路は互換維持する。
item IDをschedule projectionにも渡し、item scopeとaffectsの参照を保つ。
機微な座標/秘密キーは既存方針で除外する一方、RequestのID・日付range・constraint・affectsは途中で切り捨てない。
圧縮時もRequest/Profile/Decisionを維持し、24,000文字のContext上限に収まらないRequestは明示エラーにする。
必要条件を消して再質問させるために成功扱いすることはしない。モデル・Tool数・上限・Grounding/Viewer policyは変更しない。

検証はDomain union/validation、仮定状態、Profile優先、converterの不正値/純粋性、Agentへの型情報・参照保持を含む。
既存Smoke/Full Evalは保存済み観測を使う回帰検査であり、実モデルの会話品質保証ではない。
既存Live runnerに`trip-v2-known-request-weather`、`trip-v2-rejected-assumption-search`を追加した。
設定済みAWS認証が期限切れのため今回Liveは未実施。認証更新後は以下で実行できる（モデル設定は既存環境を使う）。

```bash
npm run eval:agent:decision:live -- --profile full --case trip-v2-known-request-weather --output-dir /tmp/raiquora-387-live-weather
npm run eval:agent:decision:live -- --profile full --case trip-v2-rejected-assumption-search --output-dir /tmp/raiquora-387-live-search
```

## 後続ownership

| Issue | 残す責務 |
| --- | --- |
| #383 / #384 | 同じTripの状態、Ask + Progress、意味解釈から確認可能なRequest Proposalへの本番接続 |
| #411 / #412 | 同じRequestのTripParty、Money/budget、該当affects/legacy mappingの最終化 |
| #402 / #406 | 全Trip成立性、全候補Assessment、natural-language条件の追加Evidence評価 |
| #388 / #389 | server保存/認可/import、revision/CAS/mutationId、writer切替時の旧Context producer廃止 |
| #390 | 同じProposal境界を使うDOM、未確認/競合/評価結果の本格表示 |

## #387 AC自己レビュー

| AC | 実装・テスト |
| --- | --- |
| 帰着期限hard / 乗換希望soft | request.test、ZonedInstant/既存Journey型、source/strengthのround-trip |
| 「頃」をrangeのまま保持 | DateRange validation/Context圧縮テスト、勝手な自然言語解釈なし |
| 未知の出発地/時刻を仮置き | origin/instant constraint + linked PlanAssumption。未解決の自由文も保持可能 |
| Profileと今回user条件の区別 | 個別採用Proposal、effective優先関係テスト |
| Place/date/timeの並行型なし | #414/#386のDomain型/validatorを再利用 |
| 保存済み過去日程を無言で新条件にしない | legacy年補正なし、V2 Contextで旧tripContextを併用しない |
| 一時判断と永続状態を分離 | AgentDecision分離、modelのuser事実への昇格拒否、入力不変テスト |
| migrationは単一入口・入力不変 | legacy-trip-request.test、既存converter回帰 |
| writer/server未有効 | Storage/Repository/会話削除変更なし、メモリ上のProposalのみ |
