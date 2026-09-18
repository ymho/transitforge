# InTripContextSnapshot (#396)

## 現行 → 変更 → 後続

| 現行 | #396 | 変更しない責務 |
| --- | --- | --- |
| AgentへTripの先頭24予定 | in_tripだけ前1/現在2/次2/後続4/未確定2を切り出す | #397の再計画/変更 |
| ImpactはID単位GET | 既存atomic最新観測pointerをTrip prefixで最大4 pages / 48件取得、関連度で選別 | #394/#408評価、#409再取得 |
| 通知Centerのcurrency | 同じcurrencyで最大4件、内部IDは除去 | #395 policy/episode/delivery |
| ReservationFact | 最大8件、失敗はunavailable | 予約正本/予約変更 |

最終契約は#382/#415、判断は[ADR 0064](../decisions/0064-bound-in-trip-read-context.md)。

## 契約・時刻・サイズ

`modules/trip/domain/in-trip-context.ts`がread modelとpure projectionを所有する。
Trip ID/revision/lifecycle、明示ZonedInstant、予定、Impact、通知、ReservationFact、environment source、location、truncationを持つ。
currentは予定上の位置であって到着/乗車実績ではない。fixed終了不明はunknown、window内はpossible-current、
dayはdate-current（宿泊checkout日exclusive）、timezone不明はunknown。DST/日跨ぎは既存schedule計算を共有する。
同じ分類内では採用順を保ち、未来予定だけnext/upcomingへ入れる。unscheduledはuncertainへ残す。

Placeは表示名のみ。鉄道は最大4legの番号/両端/計画発着だけ。生Journey/provenance/画像/raw payloadなし。
最大6Impact×4typed facts。severity/connection-buffer等を計算し直さず、内部Impact/Event/予約/Provider alert IDを除く。
不足はomitted/truncated、古いrevisionや期限切れはcurrent factsから除いてunknown。
環境値はImpact内のbinding済みweather/hazard typed factsを参照し、別のraw環境配列を作らない。
18,000文字上限。過大な入力は黙って安全条件を欠落させず失敗する。全体Agent予算24,000文字は維持する。

## 読取・整合性

`InTripContextApplication.read(principal, tripId)`でowner-scoped Trip GET→並列resource read→Trip再GET。
通知と無関係なinformational/unknown ImpactもSIGNALから取得する。pointerの再読込で読み取り中の観測変更を検出する。
取得・確認はそれぞれ最大4 pages（各12件）、計最大8 Query。Impact候補GETは最大48件。続きがあれば
truncated=trueとomittedの下限値（少なくとも1件）を残し、全件確認済みとはしない。
no-impactを後順位とした上で、現在予定→次2予定→直近後続4予定→その他、severity、status、
evaluatedAt/observedAtの新しい順、最後にstable IDの順で最大6件を選ぶ。
現在予定のattentionは遠い予定のaction-requiredより優先する。事実・severityそのものは変更しない。
Notificationの有無はImpact選別に無関係であり、未知情報も候補に残す。詳細はADR 0064を参照。
全history Scanやglobal owner一覧のfilterはない。Notificationは最新subject episodeを参照し、過去通知一覧を投入しない。
古いrevision/消えたitem/終端Trip/archiveはcurrent扱いしない。予約失敗は空の「予約なし」にしない。
read自体は各独立resourceのpoint-in-time viewであり、複数tableを跨ぐserializableな実世界snapshotを保証するものではない。

## 接続・公開gate

`createInTripContextApplication`は既存Repositoryを組成する。認証済みhostは
`createInTripContextHandler(application, authenticate)`へ渡す。公開Lambdaは引数なしで501。
bodyはversion/tripIdのみ。owner/時計/位置/Impactをpublic bodyから受け取らない。
現時点では新IAM権限・Terraform resourceを加えない。認証rollout時のread hostにはTrip/予約/ImpactのGet/Query、
通知tableのGet/Queryのみを付与し、write/Scan/worker起動権限は与えない。

Viewer→HttpInTripContextClient→Application read→loadInTripContext→既存Runtime Contextという配線。
in_trip以外はfetchしない。サーバ取得不可なら保存済み予定だけで相談し、Impact/通知/予約はunavailableとする。
通信失敗時の保存済み予定はtrip.currency=unconfirmedとし、最新版確認済みとはしない。
別revisionや終端への変更を取得できた場合は旧Tripで回答せず、Workspaceの再取得を求める。
別revisionのsnapshotをlocal Tripへrebaseしない。モデルへ固定Tool callを追加しない。
公開認証が閉じている現環境ではサーバ最新事実の自動取得は利用不可であり、実運用済みとはしない。

Locationはnot-requested/permission-denied/unavailable/availableを分離する。既定では取得しない。
explicit consent・有効座標・5分以内の観測だけをrequest-localに利用可能。Trip/PlaceSnapshotへの保存なし。
Context自体やowner/位置履歴を新しいログへ保存しない。

## テストとEval

### Application Evidence

`frontend/src/usecases/agent/in-trip-application-evidence.ts`が検証済みread modelを最大10件のEvidenceへ投影する。
DomainはEvidenceに依存しない。RuntimeのinitialEvidence入口で検証し、既存Tool分と20件枠を共有する。
current/nextの計画、保存済みtyped Impact、関連ReservationFact、位置権限状態、未確認範囲を区別する。
場所の実績や乗車を推測せず、位置座標・owner・永続Impact ID・予約番号・Provider rawを投影しない。
取得失敗したunconfirmed fallbackはEvidenceにしない。unknown/unavailableは肯定的な事実に変換しない。
EvidenceからverifiedFactsを作り、place summaryより優先して重複除去・件数制限し、圧縮でも保持する。
詳細な責務とsource typeはADR 0064を参照する。
Runtime開始時のtrace/validation、重複ID・referenceなし・予算超過拒否、Toolとの併存、pure mapperとprivate値除外、
PromptのApplication Evidence契約を回帰テスト化した。AKは「遅延/接続」の語だけで合格とせず、保存済みの乗換余裕・必要時間の説明も検査する。
既存A〜AIとTTFI/TTFC閾値、Tool availabilityは変更していない。

追加レビューでは最大10件のEvidence briefを先頭へ配置し、JSON内の同じsummaryをID参照へ置き換えた。
brief + Contextの24,000文字予算は維持する。Agent層coverageと鮮度でTool descriptorの重複能力を説明するが、Toolは隠さない。
in_tripでは計画作成用指示に代えて短い回答契約を適用する。Decision SummaryのusedEvidenceIdsは最大10件/重複禁止/実在検証し、
Traceへだけ保存する。ID宣言は自己申告なので、AJ〜AMはID/coverageに加え回答本文も検査する。
追加調査を抑制しすぎないよう、AN（天気未取得）、AO（代替列車）、AP（古い警報の最新照会）を同じRuntimeのscripted/live入口へ追加。
元の42件の6指標評価とA〜AM、Smoke 23件、TTFI/TTFC閾値は不変。FullのTrip Progressだけ39→42件となる。

Domain: fixed/重なり/window/day/unscheduled/日時不明/日跨ぎ/DST/上限/鮮度/旧revision/privacy/位置状態。
Application/SDK: 旧envelope、通知生成前のImpact読取、currency、owner隔離、read失敗、並行編集、bounded consistent Query。
hash順26番目のnext rail action-requiredの採用、関連度がseverityに優先すること、no-impactの混雑防止、
48件/4 pages上限と省略表示、cursor改ざん・循環拒否、18,000文字以内も回帰テストで固定する。
HTTP: 501 gate、forged owner/extra fields拒否。Agent: 圧縮でsnapshot保持、余分なTool callなし。
AJ〜AMはscriptedとliveの同一Runtime評価入口へ追加し、既存A〜AIのthresholdを変更しない。
保存fixtureは実ユーザーの会話ではなくsyntheticであり、scripted成功と実モデル品質は区別する。

テスト結果・Liveの可否はPRに記録する。#397・認証rollout・位置取得UI・履歴通知全件の投入は今回行わない。

## Migration / 検証記録

新table/index・Trip schema変更・LocalStorage書込・migrationはない。既存#395の観測pointerを読むだけで、
old #388 envelopeも既存Trip readerを通す。pointerがまだないTripはunknown、過去履歴から現在情報を捏造しない。
2026-09-17、Live AJを既存認証で試行したが `CredentialsProviderError: Your session has expired` で未実施。
AK〜AMも同じ認証を必要とするため実モデル検証は保留。scripted成功をLive成功として扱わない。

初回ローカル検証: Frontend/Domain 1,809件、Backend 438件、build、architecture/workspace、
Smoke（12/12、Ask 2/2、Progress 23/23）、Full（42/42、Ask 7/7、Progress 39/39）、
Python 32件、bundle/lambda、git diff --checkが成功。Terraform定義は変更していない。

PR #447レビュー修正後: Frontend/Domain 1,811件、Backend 440件、上記Smoke/Full、build、
architecture/workspace、Python 32件、bundle/lambda、git diff --checkを再実行して成功。
Terraform fmt、bootstrap/dev validateも成功（既存hash_key等の非推奨警告のみ）。
この時点ではLive AJ〜AMはAWS認証更新待ちだった。

Application Evidenceレビュー修正後: Frontend/Domain 1,822件、Backend 441件、上記Smoke/Full、
build、architecture/workspace、Python 32件、bundle/lambda、Terraform fmt/validate、git diff --checkが成功。
更新済みtransitforge-dev認証でLive AJ〜AMを再実行した。既定Nova Lite、4,096 output tokens、temperature=0、
各1試行、既存閾値・Tool公開範囲のままで、最終結果は0/4。AJ/AMは1 model / 0 Toolだが説明不足、
AKは3 model / 1 Tool、ALは5 model / 3 Toolで不要呼出しと説明不足が残る。
初期Evidence登録・モデル入力への反映は検査済みであり、認証やEvidence未接続の問題とは区別する。
AKでは保存済み乗換余裕4分・必要5分を回答する検査を追加し、単語一致だけの合格を避けた。
実モデルの根拠利用・Tool判断は未達。scripted成功をLive成功とせず、PRはDraftを維持する。

2026-09-18、Evidence brief/coverage/usedEvidenceIdsのレビュー修正後に、同じモデル・温度・上限でAJ〜APを各1試行した。
AJ〜AMは全件1 model / 0 Toolとなったが、本文監査で予定を実際の現在地/乗車として断定する例を検出した。
この見逃しを回帰検査に追加した最終結果は0/4。AKは必要時間の説明、ALはhazard Evidenceの使用宣言も不足する。
AN（予報未取得）とAP（最新警報）は2 model / 1 Toolで合格、AO（代替列車）は4 model / 2 Toolで不合格。
Toolは公開されたままで、追加調査の実行可否はscriptedでも検査する。Liveの代替経路選択品質は未達。
途中の合格だけを採用せず、必要な検査を強化した結果をPRへ記録する。特定発話のproduction routerや自動計画変更はない。
synthetic Live reportには監査用の公開回答（最大2,000文字）とusedEvidenceIdsだけを追加し、内部思考や本番会話を保存しない。
## PR #447: structured factual presentationの追加レビュー

`InTripAnswerPlan`はDecision Summary内の既存Evidence参照だけであり、モデルが新しい事実を書くschemaではない。
最大6件、presentation/sourceType/coverage、実在ID、usedEvidenceIdsへの包含をRuntimeで検証する。
不正・欠落時にモデル自由文を表示しない。一般planning回答にはこの制約を追加しない。
実装は`frontend/src/usecases/agent/in-trip-answer-plan.ts`、既存Application Evidence mapper、Runtime/Traceへ閉じる。
DomainのTrip/Impact再評価、Tool router、公開Tool削減は追加しない。

Before: モデルがEvidenceを正しく選んでも、自由文で計画を実現在地や実乗車へ昇格できた。
After: モデルはEvidenceの選択と順序、Applicationは事実本文を所有する。
自由文のsuggestionは今回は付加しない。数字・現在地等を再説明する自由文を別名で通す抜け道を作らない。
既存Tool結果の構造化カード・terminal responseは残す。保存済みImpactと新規Provider結果を混同しない。
予定上のcurrentは実際の位置ではない。保存済みdelay/connection-bufferは単位付きでそのまま表示する。
unknown、query-limited、位置未許可、表示省略を明示し、「安全」「営業確認済み」へ置き換えない。

AJ〜AMは従来の検査に加え、実際のAnswerPlanと表示結果を検査する。モデル自由文の誤った乗車断定を
Runtimeが拒否または描画から排除するテストを追加した。既存A〜AI、AN/AP、TTFI/TTFCは変更しない。
AO診断はsynthetic fixtureに限定したTool順/結果コードと構造化意思決定だけで、raw入力や内部思考を含まない。

今回のLive AO再実行は`transitforge-dev`のSSO Token expiredでモデル実行前に失敗した。
これはAOのTool失敗とは分類しない。AJ〜APの新実装でのLive成功は未確認であり、Draftを維持する。
前回の0/4、AN/AP成功、AO失敗という履歴を以下に残す。認証更新後に最新headで7ケースを再実行する。

今回のローカル確認: frontend/domain 1,869件、backend 444件、build、architecture/workspace、
Smoke（12/12・Ask 2/2・Progress 23/23）、Full（42/42・Ask 7/7・Progress 42/42）、
Python 32件、Terraform fmt/validate（dev/bootstrap、既存deprecated警告のみ）、bundle/lambda、diff checkが成功。
Scripted成功をLive合格とは扱わない。

### 2026-09-18 AWS認証更新後

`transitforge-dev`で実モデルへ到達することを確認した。モデル/temperature/上限/Tool公開範囲/閾値は変更していない。
AnswerPlanをSystemのwire format例へ含め、任意Decision metadataと独立してstrictに検証する。
初期Evidenceと新規Tool Evidenceの対応presentationはrendererと同じ関数から提示する。
Tool後にmapperが作るEvidence参照がモデルへ返っていなかった欠落を補い、weather/hazardの取得結果専用
`external-result`を追加した。これは取得状態だけを説明し、外部事実を保存済みImpactとして通さない。
Provider Evidenceがない場合のunconfirmed outcomeも、外部情報が確認できたとは扱わない。

AOの診断では表示中列車検索の誤選択と検索条件不足を確認し、descriptorで独立駅間経路との責務を分けた。
以後は`search_direct_routes`が600分を下限として正常実行された。合成fixtureの検索結果は空であり、
実Providerの経路発見を検証したという意味ではない。

途中のAJ〜AM 4/4合格やAN/AP改善だけで完了とはしない。最新の同一コード7ケース通しLiveは5/7。
AJ/AMは1 model・0 Tool、AN/APは2 model・1 Tool、AOは1 model・1 Toolで合格。
AKは不要Toolとinvalid input、ALはweatherだけを選びhazardを落としたため不合格。
追加診断でもAKは遅延Toolへ逃げ、ALは不要Web検索後の不適切なEvidence参照を拒否されて失敗した。
失敗を安全な回答として数えず、Draftを維持する。残件はモデルによる必要Evidence選択と不要Tool抑制。
Liveレポート: `/tmp/447-contract-<case-id>/trip-progress-live.json`。診断も合成データのみで、本番会話・内部思考は記録しない。

今回のローカル確認: frontend/domain 1,877件、backend 444件、build、architecture/workspace、
Smoke（12/12・Ask 2/2・Progress 23/23）、Full（42/42・Ask 7/7・Progress 42/42）、Python 32件、
Terraform fmt/validate（dev/bootstrap、既存deprecated警告のみ）、bundle/lambda、diff checkが成功した。

### AK / AL残件の契約修正

遅延分析Toolは専用decision supportで業務日全体の観測分析と個別TripImpactの説明を区別する。
分析Toolを非表示にせず、既存日別分析テストで実行可能性を維持する。代替経路は既存search_direct_routesの責務。

天気・警報はAgent mapperで一つのenvironment Evidenceに集約し、回答用presentationを
`environment-impact`に一本化した。Domainのread model、Trip、Impact、Provider取得処理は変えない。
個別weather/hazard presentationはparser/Runtimeから廃止し、bundleの一部だけ選んで警報を落とす経路をなくす。
`external-result`は今回Toolが取得した結果の表示として維持し、保存済みbundleとは混ぜない。

weather+hazard/片方のみ、保存済み値との一致、pure projection、位置や危険の非推測、
hazard適用範囲/有効期間のunknown保持、旧presentation拒否を回帰テスト化した。
ALのEvalは両方の保存済み評価と未確認事項がrenderer本文にあることを追加検査する。
最終Liveは同一headのAJ〜AP全件実行で判定し、過去の成功を合成しない。結果はPR #447に記録する。
