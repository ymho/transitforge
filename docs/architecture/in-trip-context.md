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
