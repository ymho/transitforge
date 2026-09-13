# ADR 0055: Reservationを独立resourceとして保存し予約済み予定を確認で保護する

- ステータス: Accepted
- 日付: 2026-09-13
- 対象: #398、親 #382/#415、前提 ADR 0052/0053/0054

## 決定

ReservationをTrip.itemsやselected snapshotへ埋め込まず、Trip IDと任意item IDを参照する独立entityにする。
同じDynamoDB tableのowner-scoped別namespaceへ保存し、独立revisionのconditional Putでlost updateを防ぐ。
Trip更新用receipt/frameworkを汎用化しない。成否不明のReservation更新はGETと再確認で回復する。

bookingReferenceはprivate detailに閉じ、Workspace/Agent/将来feasibilityへは同じallowlist read projectionを渡す。
予約状態を推論するToolや予約実行APIは追加せず、typed commandのtrusted確認・保持許諾境界を用いる。
Trip remove/replace時はApplicationが予約を照会し、bookedならProposalと予約revisionに結び付く明示確認を要求する。
予約自体を自動変更しない。照会失敗は予約なしではない。

## 理由と代替案

- selectionへbookedを追加すると候補採用と実予約が混ざり、独立した予約履歴・privacy・複数予約を失う。
- Trip内配列では予約番号が通常Trip Contextへ漏れるリスクがあり、無関係なTrip編集とも競合する。
- 別サービス/tableは現段階の規模には不要。同じtableのkey分離と既存IAM/暗号化/PITRを再利用する。
- 完全なcross-resource transaction、予約のreceipt汎用化は今は追加しない。残るrace/partial failureを明示する。
- 「変更が必要」は保存statusに増やさず#402の導出に残す。

## 公開gateと限界

公開認証がないため本番writerはOFF。内部composition/preview/read projectionだけを提供する。
確認keyは署名ではなくtrusted hostへの契約であり、bodyの自己申告を認可へ使わない。
Tripと予約を跨ぐ原子性は未保証、削除後のlinkと元予約は保持する。公開rollout時に並行操作方針を再確認する。
Provider取得/保持許諾が未確認の情報やlegacy bookingUrlから予約を作らない。

詳細・AC・失敗時の扱いは [Reservation導入記録](../architecture/trip-reservation.md) を参照する。
