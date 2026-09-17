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
別の正本・index・dual-writeを追加しない。owner PK + SIGNAL#trip prefixへconsistent Queryを最大12件行い、
参照Impactを取得する。Notification/episodeが0件でもImpactを読める。通知のworkStateを鮮度判定に使わない。
最後に同じpointer集合とTripを再読込し、競合は取得不可/失敗とする。新鮮なall-clearへ変換しない。
12件外や過去revisionのpointerにより範囲が不足した場合はtruncation/unknownを残す。
履歴からのbackfillは行わず、既存#409のfresh recheckが新しいpointerを生成する。

## 通知・予約・認可

通知はbounded subjectのlatest episode参照から既存NotificationApplication.currencyを再利用する。
別通知policyを作らずcurrent/historical/unconfirmedを保持する。予約はReservationReader.factsのみ。
個別read失敗はunavailableであり、成功した空配列とは異なる。最後のTrip再GETでrevision/archive競合を拒否する。
公開read APIは既存end-user認証gateを継承し501のまま。認証/同意をbodyから捏造しない。

## LocationとAgent

既定not-requested。現在のViewerは位置取得・送信を新設しない。explicit consentを伴う別hostの
request-local入力だけavailableにでき、5分超・不正座標はunavailable。拒否/未取得を分ける。
生座標の利用を有効化するUIは今回なく、既存「位置は端末外へ送らない」を変更しない。
AgentのContext圧縮でもinTripを丸ごと保持し、予算超過時に安全情報を黙って落とさない。
planning側の全予定/場所履歴/旧経路の重複を除く。新しいmodel call、固定Tool chain、Traceへのsnapshot保存を追加しない。

## 残す責務

#397の残り旅程Patch、完了保護、予約変更確認、#399の認可rolloutは別。Trip・Reservation・通知stateを更新しない。
大規模UI、background GPS、Provider再検索は対象外。実装と検証は[導入記録](../architecture/in-trip-context.md)。
