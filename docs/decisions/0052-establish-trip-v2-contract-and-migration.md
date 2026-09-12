# ADR 0052: Trip V2の正本契約と段階migrationを確定する

- ステータス: Accepted（設計採用。機能の導入は後続Issue）
- 日付: 2026-09-12
- 親方針: [#382](https://github.com/ymho/transitforge/issues/382)
- 担当: [#415](https://github.com/ymho/transitforge/issues/415)

## 背景

現在は検索応答のTravelPlanと編集用TripPlanが別にあり、TripPlanには経路/宿泊の候補も保存される。
今回条件はTripContext、旅程は会話UUID別LocalStorage、会話削除は旅程削除にも結び付く。
後続Issueが独立してこれらを変更すると、要求の二重正本と短命な保存形式migrationが増える。

#382は相談から旅行前・旅行中・再計画までを対象とする。Agent基盤#306の判断主体と、
Tripの永続状態の所有者を分けたまま、各PRが向かう最終契約を先に確定する。

## 選択肢

1. TravelPlan/TripPlan/TripContextを残したまま各機能を追加する。
   候補・要求・採用済み旅程の境界が曖昧で、共有/監視へ進むほど同期箇所が増える。
2. 全モデルとサーバ永続化・UIを一度に置き換える。
   既存データと経路検索の回帰範囲が大きく、個別PRで検証できない。
3. 正本契約・migration ownershipを先に採用し、単一converterとwriter切替gateで段階実装する。
   実装待ちの契約を明示する必要があるが、レビュー可能な大きさと互換性を両立できる。

## 決定

選択肢3を採用する。具体的な型、invariant、変更適用、移行順序、ACとの対応は
[Tripライフサイクル契約](../architecture/trip-lifecycle.md)を唯一の詳細設計とする。

- 将来の編集正本は`Trip`。`TripRequest`はその子value objectで、独立Repositoryを作らない。
- planningStateとlifecycleStateはTripが所有する。状態は現在地を表し、Tool/質問順を固定しない。
- ItineraryはTrip.itemsの採用済み予定。候補集合、予約、外部観測、影響、通知を分離する。
- 時刻・経路・乗換・制約validationは既存のshared Domain計算を再利用する。
- 鉄道は「検索結果`JourneyRouteResult` → 採用時の計画専用`SelectedRailJourney` →
  別管理の`TrainOperation` / `TravelEvent` / `TripImpact`」の3層とする。
  TripにはserviceDate・serviceUid・列車番号・区間・scheduled時刻・乗換・verifiedな出所と
  再検証情報だけを明示変換して保存する。生の検索結果やそのalias/除外型を保存型にしない。
  遅延・現在status・補正済み発着時刻はprovenance内も含め保存禁止とする。
  #385が独立value objectとallowlist変換・保存境界を実装し、#386の時刻計算を再利用する。
  #393/#394の観測・影響は計画へ関連付けるだけで、再観測によるTripの無言の上書きをしない。
- Provider Offeringと採用Snapshotは意味が異なる。予約状態は別aggregateとする。
- Trip IDは会話IDと独立する。会話はtripId参照、会話削除はTrip削除を伴わない。
- Domain schemaVersion、編集revision、wire version、DB storageVersionは意味を分ける。
- Profile/AgentDecision/過去の会話応答はTripRequestの並行正本にならない。
- Domainは`modules/trip/domain`、Backend Repository portは既存規則どおり`src/ports`、
  永続化・HTTP・Browser実装はAdapterへ置く。新サービス/packageは追加しない。
- #415では未使用のV2型やDTO/Repositoryをexportしない。文書内に型の骨格を示し、
  #385から実際の利用箇所とテストとともに同じmoduleへ実装する。
- 旧reader互換と原本保全を伴う1つのlegacy→V2変換を作る。各fieldの移行担当を固定する。
  Domain移行後にserver移行用の別Domainモデルを作らない。
- サーバAPIを無認可/無条件更新で先行公開しない。#388のCAS/取込primitiveと#389の
  全Proposal・UIのrevision統合が揃ってからBrowserの正本writerを切り替える。

## 既存判断との関係

| 判断 | 継承 / 部分置換 |
| --- | --- |
| ADR 0011 / 0016 / 0017 | 自前の日付別時刻表、4時境界、CSA、外部Provider境界を維持。初期の直通のみという範囲は現行探索を縮小する理由にしない |
| ADR 0018 | 「候補は鉄道1経路必須」「既知の円価格のみ」を#385/#413/#412で置換。検証済み鉄道と運賃除外、不明価格非推測は維持 |
| ADR 0035 | 今回条件のTripContext正本を#387のTripRequestへ置換。Profileの端末保存・allowlist・今回条件優先・privacyは維持 |
| ADR 0037 | TypeScript workspace/shared Domainと既存実行境界を維持。DomainにRepository実装を入れない |
| ADR 0041 | 検索時のMapbox地点同定を維持。Tripへ保存するidentityは#414のProvider非依存契約とする。Search Box結果の恒久保存禁止は撤回しない |
| ADR 0021 / 0023 / 0026 / 0031 / 0038 | Tool境界、bounded Runtime、Evidence/Claim、結果駆動replan、単一本番Runtimeを維持 |
| ADR 0044 / 0045 / 0046 | Bedrockの意味解釈・Tool選択・外部化可能なDecisionを維持。Tripの状態所有や保存権限までは委譲しない |
| ADR 0049 | 直接Viewer操作の非公開と結果表示の安全境界を維持 |
| 現行domain-model/product-briefの1会話1旅程/LocalStorage記述 | 現在稼働中のlegacy説明として残し、最終方針を本契約で置換 |

過去ADRは当時の判断を残し、該当箇所へ本ADRへの注記を加える。既存実装が#415後すぐに
V2へ変わったという記述にはしない。#368/#380の残務は既に#382配下へ統合されており再実装しない。
検索/地点同定/Groundingの#366/#376/#377は独立した修正で、本PRのclosing対象にしない。

## 影響・リスク

- 後続Issueは1つの契約へ向かい、候補の監視や古い会話による旅程の上書きを避けられる。
- 個別PRを可能にするため、新しいconverter/readerの導入と本番writerの切替を分離する。
- 意図した変更として#383は#385のTrip骨格後、#384は#387の仮定契約と統合して実装する。
  #388/#389の境界で安全なCRUDとProposal対応を調整し、無防備な中間releaseを禁止する。
- 旧データに採用経路・観測日時・条件の出所がない場合、完全な復元は証明できない。
  原本保全と要確認を返し、先頭候補の自動採用や移行時刻の偽装で穴を埋めない。
  scheduled値やprovenance不足の旧経路はunresolvedとし、遅延の引き算で計画を捏造しない。
  遅延時だけ成立する接続は、計画snapshotとして採用する前にscheduled時刻で検証する。
- Providerの保存許諾が不明な値をserverへ移せない。#414/#400は再取得/利用者入力を含む
  部分移行の説明と試験を持つ。名前をmanualへ付け替えて制約を回避しない。
- 認証方式そのものは#415で追加しない。#388は信頼できる所有者識別がなければ公開をgateする。
- 現architecture checkerはimport方向の一部を検査するが、全越境や意味上の二重正本を検出しない。
  本PRで規則を緩和せず、#388の追加境界は負例テストと所有権レビューを伴わせる。

## 検証

#385の段階実装と検証は[コア導入記録](../architecture/trip-v2-core.md)を参照する。
最終契約は変更せず、Trip型と採用境界の導入を本番writer切替とは分離している。
#414の同じPlace型への統合と保存制約・legacy変換は[Place導入記録](../architecture/trip-place-snapshot.md)を参照する。
#386の共通schedule、ZonedInstant、鉄道/宿泊projection、既存converter拡張は
[Schedule導入記録](../architecture/trip-schedule.md)を参照する。本番writerのgateは解除しない。
#387の同じTrip.request、仮定/出所、最小評価、Agent投影と旧条件の部分変換は
[Request導入記録](../architecture/trip-request.md)を参照する。別Request RepositoryやTripContextへのdual-writeは追加しない。
#383の同じTripへのplanning/lifecycle、注入Clockによる精度別評価、確認Proposalとlegacy mappingは
[状態導入記録](../architecture/trip-state.md)を参照する。状態をTool routerにせず、ready認定は#402まで拒否し、
completedは今は明示確認のみ。時刻だけで実績を生成せず、writer gateも解除しない。

#384の[Ask + Progress導入記録](../architecture/ask-progress.md)では、同じTripの読み取りと既存Proposalを
production Agent Runtimeへ接続する。回答outcomeは一時的観測であり、Trip/Conversationの新しい進行正本ではない。
LLMがTool/質問/推薦を選び、既存Domain検証・Evidence・Viewer Action・実行上限を維持する。writer gateは解除しない。

#410の[Activity導入記録](../architecture/trip-activity.md)では、同じItineraryItemへactivity、同じPatchへaddを追加する。
Place/schedule/PlanAssumption/VisibleProgressを再利用し、Provider候補の採用と原子的previewを検証する。
Reservation/Money、CAS/永続化、全面UIの責務は後続へ残し、writer gateは解除しない。

#415は設計変更だけなので本番モデル・Tool・migrationは実行しない。
#411の[TripParty導入記録](../architecture/trip-party.md)では、同じTrip.request.partyと既存PlanAssumptionを統合した。
Profile・legacy・モデル仮置きと今回ユーザー人数を分離し、未知年齢を保持する。モデル由来のsource=assumptionは
既存constraintと同じ相互参照を使う。Provider別の年齢必須条件はAdapter、writer/CASは後続のままとする。

#413の[Transport導入記録](../architecture/trip-transport.md)では、同じtransportを非鉄道へ広げる。
manualはselected予定＋manual provenance、Provider採用はID解決・許諾・durable Evidenceの検証を経る。
両端はdetail内（railはlegs）に保持し、時刻は共通schedule。本文の計画/観測/予約分離とwriter gateは維持する。

`npm test`、`npm run build`、`npm run architecture:check`、`npm run workspace:check`を実行する。
#400の[宿泊Snapshot導入記録](../architecture/trip-accommodation.md)では、同じselected stayをAccommodationSnapshotへ統合する。
商品identityと施設Place identityを別に解決し、保持許諾・出所・採用時点を検証する。価格・空室・画像・review・予約導線は
Offering側に留め、Money/Reservationは後続へ残す。legacyの証拠不足を捏造せず、writer gateも解除しない。

#412の[Money導入記録](../architecture/trip-money.md)では、同じOffering/Trip/Requestへ原通貨Moneyと観測を導入する。
公式リストから確認した6通貨のminor unitを固定し、未対応通貨を拒否する。曖昧だった観測日時は必須とし、
日時不明のlegacy価格はPriceObservationへ昇格させない。保持根拠は既存Snapshot.sourcesを再利用する。
価格の明示許諾と時系列を検証し、別通貨を合算せず、FX/予算内保証/本番writerを追加しない。

後続PRのmigration/invalid/retry/partial failure/backward compatibility試験は
詳細契約の適合ケース表に割り当てる。#415のACは設計として自己レビューし、#415だけを閉じるPRにする。
