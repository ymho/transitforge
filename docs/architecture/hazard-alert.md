# 公的ハザード事実の契約 (#401)

親方針は #382/#415 と ADR 0052。ADR 0043の公的防災Toolを維持し、
`TravelAlert` を `HazardAlert` と明確化した。外部事実・計画・影響・通知を混ぜない。

## 現行 → 今回 → 後続

| 現行 | #401で確定・変更したもの | 残す責務 |
| --- | --- | --- |
| TravelAlert / travel-alert.ts | HazardAlert / hazard-alert.ts、単一Domain validator | 検索結果でありTripの保存itemではない |
| JmaTravelAlertProvider | JmaHazardAlertProvider、allowlist変換と失敗/不正応答の区別 | 全JMA電文の地理包含・解除・有効期間の解釈は実装しない |
| travel-alert-search | hazard-alert-search、query/Provider応答の共通検証 | HTTP operationは互換名のまま |
| Agent / HTTP依存のsearchTravelAlerts | 内部名searchHazardAlerts、bounded observation | Tool名search_travel_alertsは変更しない |
| #406 Candidate Assessment | 同じHazardAlertSearchResultをread-onlyで検証・評価 | candidateの自動rejectやTrip feasibilityへの流用はしない |
| #402 Feasibility | evaluator/ready policyを変更しない | Tripへの具体的影響は#393/#394/#408 |
| #392 Preparation | 検索では保存・Proposal生成しない | 必要な準備をAgentが別途提案し、利用者が確認する |
| Event / Impact / Notification | 型・Repository・workerを追加しない | #393 / #394 / #395 |

## 正本と責務境界

- `HazardAlert`: JMA等の公的外部ハザード発表。公的severityはinformation/advisory/warning/emergency/unknown。
- `TravelEvent` (#393): Provider非依存の現実世界のイベント。
- `TripImpact` (#393/#394): Eventを特定Tripの計画・revisionと照合した派生影響。
- `Notification` (#395): 利用者へ何を届けたか、送信・既読・抑止等の独立状態。

`HazardAlertSeverity`にcritical/action-required等のTrip影響分類を入れない。
emergencyからTrip infeasible、通知criticalへの変換はない。HazardAlertはsent/read/notifiedAt/
notificationId/deliveryStatus/suppressed等を持たず、未知fieldとして拒否する。

## Domain・Wire契約

`modules/trip/domain/hazard-alert.ts`を唯一の契約にする。
旧型の別定義や互換aliasは不要だったため残さず、主要な内部利用箇所を同PRで移した。

- `HazardAlertQuery`: area（NFKC/trim後1〜80文字）、任意のcategory配列（最大7、既知enum・重複なし）、limit（整数1〜12、既定8）。
- `HazardAlert`: providerAlertId（opaque、1〜300）、category、severity、title（1〜160）、summary（1〜600）、issuedAt（valid instant）、issuer（任意1〜120）、sourceUrl。
- `HazardAlertSearchResult`: areaと最大12 alerts。areaは**検索対象**であり、正確な影響区域やTripとの交差の証明ではない。
- `HazardAlertProvider`: 既存`ExternalTravelProviderPort<Query, Result>`。
- `ExternalTravelInformation<HazardAlertSearchResult>`: available/unavailable/unknown、freshness、既存ExternalSourceEvidence、failureを維持。

共有validatorはDomain純粋関数。query/result/alert/envelope/source/failureの未知fieldを拒否し、
不正なcategoryやlimitを黙って削除・clampして成功させない。
URLはHTTPSかつcredentials/query/fragmentなし。既存`validateExternalSourceEvidence`の方針を再利用し、
危険なURLをquery削除で別URLに変えて証拠扱いしない。source metadataにも件数・文字数制限を設ける。

HTTPリクエストは引き続き`operation: "travel_alert_search"`。
応答は`{ alerts: ExternalTravelInformation<...> }`、Agent Tool名は`search_travel_alerts`のまま。
JSON field、status、severity enumの正常なwireは変えない。不正値は以前通っていても拒否する。
Frontend受信とBackend出力に同じvalidatorを使い、HTTP/Toolの所属queryとarea/category/limitも照合する。

取得成功・0件でも`data.area`は保持する。取得失敗は従来どおりdataなし＋failureであり、
呼出元のquery/Tool traceが検索範囲の正本になる。失敗から空のHazard factやEventを生成しない。
後続workerも結果単体ではなくqueryと取得結果を対として扱う必要がある。

## JMA Adapter

extra/eqvolの既存Atom feed、8秒timeout、各768KiB、1分cache、最大240の保持を維持。
warning/weather-information/typhoon/earthquake/tsunami/volcano/otherを維持する。
公的severityの分類は従来の発表本文の分類を維持し、Trip向けscoreへ変換しない。

XML rawをspreadせず保存可能fieldだけを明示構築する。タイトル・概要は表示用にboundedにするが、
opaqueなID/URLはtruncateやNFKCで別identityにしない。ID/URLの不正や必須値欠落はinvalid_response。
HTTP/片方のfeed失敗はunavailable。壊れたfeedを空の成功として扱わない。
cache再利用時は元のretrievedAtを保持し、検索時刻を新しい観測時刻として偽装しない。
5分のfreshnessは**取得したfeedの鮮度**であり、個々の警報の有効期限の保証ではない。

現Readerは既存JMA Atom subsetを対象とする。任意XMLの汎用parserや全電文readerを新設していない。
areaはtitle/summary/issuerの文字列照合であり、施設の地理包含、取り消し電文、未来の旅行日への影響を保証しない。
alertあり≠候補reject、空feed≠safe、未取得/unavailable/stale≠safeのままとする。

## Agent / Evidence / 評価

モデルにはarea（検索範囲）、status/freshness、最大12件のcategory/severity/title/summary/issuedAtと
最大24件のboundedな既存Source Evidenceだけを明示投影する。alertのopaque ID/issuer等は
後続Domain処理と表示用の取得結果に残すが、モデルの意思決定に不要なProvider値は送らない。
failureはcode/retryableだけ投影する。raw XML/巨大本文やProvider error本文は渡さない。

Tool descriptorに公的事実とTrip影響が別であること、未評価を断定しないことを記す。
固定質問順、Planner、常時Reflection、新しいmodel callを追加しない。
取得はread-onlyでありTripPatch、Checklist保存、Notification発火の入口を持たない。
準備提案が必要なら既存ChecklistProposal→preview→利用者確認を使い、done/not-neededは維持する。

既存A〜AHの値とthresholdを変更せず、AI-hazard-not-impactを追加した。
production Runtime/registry/Context/Evidenceを通し、ProviderとモデルIOだけを合成する。
AIは公的emergencyとEvidenceの提供、Trip/予約/Checklist/Feasibility不変、別Actionなしを検証する。
scripted model/tool callは2/1。新旅程生成の依頼ではないためTTFC/TTFIはnullであり、0に偽装しない。
Smokeは19件、Fullは35件のTrip Progress（保存済み観測12/42、Ask + Progress 2/7は維持）。

scriptedの説明文はモデル品質や現実の遅延の証明ではない。全自由文の意味的なgroundingは
既存Claim検証だけでは保証されない。Live Evalは既存のAWS認証期限切れの記録を維持し、本変更では実施しない。
認証更新後の再確認は`npm run eval:agent:decision:live -- --suite trip-progress --profile full`を使う。

## Migration / 検証 / 後続

Trip JSON、LocalStorage、server保存にHazard配列を追加しないためmigrationなし。
public writer gate、#438のStay non-blocking unknown、CAS、Reservation privacyは変更しない。
新Provider/インフラ/packageは追加しない。ADR 0043/0052と整合するため新ADRは不要。

検証対象: 全category/severity、invalid/unknown field、ID/本文bounds、時刻/安全URL、JMA feed失敗/不正/空結果、
query/category/limit、Evidenceとcache鮮度、HTTP round-trip、Candidate present/empty/unavailable/unknown、bounded Agent投影、AI Eval。
`npm test` / `npm run build` / `npm run architecture:check` / `npm run workspace:check` /
`npm run eval:agent:smoke` / `npm run eval:agent:full` / `git diff --check`を実行する。

#393にWatch/Event/Impactの同定とscope変換、#394にTrip影響評価、#408に天候/警報影響、
#395にNotification保存/dedupe/配信を残す。JMA検索の成功をこれらの実装完了としない。
