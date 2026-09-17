# ADR 0064: 旅行中の事実をbounded read contextへ投影する

- ステータス: Accepted
- 日付: 2026-09-17
- Issue: #396（親 #382 / #415、ADR 0052）

## 決定

Tripは変更せず、Applicationがlifecycle=in_tripのときだけrequest-localなInTripContextSnapshotを作る。
既存scheduleのpositionAtを共有し、window/dayをfixedに昇格させない。予定位置と現在地は異なる。
Domainはprecision/currentness/freshnessとallowlist/bounds、Applicationはtrusted principalで再読込とfailure状態、
Adapterはbounded Query、モデルは説明・選択肢提案を担当する。Tool順序や発話routerを追加しない。

## Impact読取の比較

1. Notification一覧から復元: informational/unknownを欠落させるため不採用。
2. 全Impact履歴をScan/Query全page: state identityのA→B→Aや古い事実の混入、無制限readのため不採用。
3. #395で全Impact保存とatomicに更新されるSIGNALの最新観測pointerを再利用: 採用。

SIGNALは通知可否と独立したowner+Trip+subject/chunkのlatest-observation projectionである。
別の正本・index・dual-writeを追加しない。owner PK + SIGNAL#trip prefixへconsistent Queryを1 page最大12件、
最大4 pages / 48 observationsまで行い、
参照Impactを取得する。Notification/episodeが0件でもImpactを読める。通知のworkStateを鮮度判定に使わない。
最後に同じpointer集合とTripを再読込し、競合は取得不可/失敗とする。新鮮なall-clearへ変換しない。
整合性確認も同じ上限で再読込するため、1 requestでは最大8 Query（取得4 + 確認4）、Impact候補readは最大48件・同時4件。
各Impact readは既存RepositoryによるTrip currentnessのGETも含む。無制限fan-outや48件の直列network待ちは作らない。
cursorはsubject hashだけとし、owner/Trip keyはtrusted principalと対象Tripから組み立てる。繰り返すcursorや不正pageは失敗する。
48件外に続きがある場合はtruncated=true、omittedに少なくとも1件を加える（残件数の下限であり全件数ではない）。
過去revisionや期限切れ等で確認できない情報はunknownを残す。
履歴からのbackfillは行わず、既存#409のfresh recheckが新しいpointerを生成する。

## ContextへのImpact選択

hash順は取得順であって重要度ではない。全取得候補のcurrentness/freshnessを検証した後、pure Domainで最大6件へ絞る。
no-impactはimpact/unknownを押し出さないよう全体の後順位とする。それ以外は次の順で比較する。

1. 現在予定（possible-current/date-currentも含む）→次2予定→直近後続4予定→その他への影響
2. 保存済みseverity: critical → action-required → attention → informational
3. 保存済みstatus: impact → unknown → no-impact
4. evaluatedAt、observedAtの新しい順
5. 最後だけstable Impact IDの辞書順（IDはContextへ送らない）

例えば現在予定のattentionは、遠いfuture予定のaction-requiredより優先する。
複数itemへ影響する場合は最も関連するitemで評価する。現在予定の関連度は表示枠2件に切る前の全予定から判定する。
severity/乗換成立性を再計算せず、Notification有無やLLM判断を選別に使わない。
Notificationの既存最大12 subject読取は独立で、範囲不足をnotificationTruncatedへ残す。
最終6 Impact × 4 facts / 18,000文字は変更しない。取得上限外の全riskを網羅したとは扱わない。

## 通知・予約・認可

通知はbounded subjectのlatest episode参照から既存NotificationApplication.currencyを再利用する。
別通知policyを作らずcurrent/historical/unconfirmedを保持する。予約はReservationReader.factsのみ。
個別read失敗はunavailableであり、成功した空配列とは異なる。最後のTrip再GETでrevision/archive競合を拒否する。
公開read APIは既存end-user認証gateを継承し501のまま。認証/同意をbodyから捏造しない。

## LocationとAgent

### Agent Evidenceの接続

Agent EvidenceはTool EvidenceとApplication Evidenceを含む。Trip DomainへAgentのEvidence型は持ち込まない。
`inTripApplicationEvidence`はowner-scoped readerの検証済みsnapshot（currency=current）のみからpureに生成する。
current/nextの採用済み計画、最大6 Impact、関連する既知ReservationFact、location permission state、未確認範囲で最大10件。
一般Context・Profile・会話要約・モデル解釈・候補・未確認のローカルfallbackをEvidenceへ昇格させない。
計画はdeterministic_fact、保存済みImpactはderived_value、unknown Impact/不足範囲はunverified_informationとし、
未確認を正常・安全に変換しない。時刻・遅延・乗換を再計算しない。予約private値、Impact ID、Provider raw、位置座標を含めない。
sourceTypeはtrip-state/trip-impact/reservation-state/session-stateを使い、sourceRefは当該実行のsnapshot内参照とrevisionのみ。

`AgentRuntimeRequest.initialEvidence`はtrusted Application専用入口。public request bodyやモデル出力から代入しない。
Runtimeは開始時に既存Evidence/Claim validatorで重複ID・referenceを検証し、空sourceRef・上限超過も拒否する。
検証後のcloneをevidence[]に登録してevidence_collectedを記録する。Traceは従来どおりID/category/sourceTypeだけで、本文や内部思考を保存しない。
Tool EvidenceとmaxEvidence=20を共有し、Applicationの最大10件によりTool用の余地を残す。一般のTool利用可否は変えない。
initialEvidenceのsummaryからverifiedFactsを作り、既存place summaryとID重複を除いて統合する。Applicationを先に最大20件へ収め、
Context圧縮でもverifiedFactsを失わない。summaryに保存済みの予定・測定値を直接示し、指示だけで参照を要求しない。
System PromptとTool後finalizationは両Evidenceを回答根拠とし、既にある根拠の再取得を必須としない。
unknownは本人への質問必須ではなく未確認として説明可能。追加Toolは質問への回答に必要な場合に選べる。
固定Tool順、発話regex、モデル固有分岐、Tool非表示、Claim validatorやEval閾値の緩和は導入しない。

既定not-requested。現在のViewerは位置取得・送信を新設しない。explicit consentを伴う別hostの
request-local入力だけavailableにでき、5分超・不正座標はunavailable。拒否/未取得を分ける。
生座標の利用を有効化するUIは今回なく、既存「位置は端末外へ送らない」を変更しない。
AgentのContext圧縮でもinTripを丸ごと保持し、予算超過時に安全情報を黙って落とさない。
planning側の全予定/場所履歴/旧経路の重複を除く。新しいmodel call、固定Tool chain、Traceへのsnapshot保存を追加しない。

## 残す責務

#397の残り旅程Patch、完了保護、予約変更確認、#399の認可rolloutは別。Trip・Reservation・通知stateを更新しない。
大規模UI、background GPS、Provider再検索は対象外。実装と検証は[導入記録](../architecture/in-trip-context.md)。
