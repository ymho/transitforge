# 予定の予約マーク

Trip V2/V3の各itemはoptional bookingStatus（booked / not-required）を持つ。未登録は「未確認」であり、未予約と断定しない。利用者の自己申告であり、外部予約・購入・取消は行わず、Providerで検証済みのReservationFactに変換しない。既存の独立Reservationと予約番号のprivate境界を維持する。

予定詳細のコンパクトな「予約」選択で未確認 / 予約済 / 予約不要を保存する。item_booking patchを既存のTrip mutation・revision CAS・receiptで処理する。Owner / Editorが更新でき、Viewerは閲覧のみ。画面からの保存は即時反映し、成功・失敗を通知する。

旅程を確定・再確定する際は、宿泊と移動（徒歩・自転車・自家用車を除く）のマークが未確認なら対象名をアプリ内確認ダイアログへ表示する。独立ReservationFactのbooked / not-requiredも警告除外に使う。取消は保存せず、続行は通常の確定処理へ進む。予約を必須条件にせず、未確認が実際の未予約を意味するとは扱わない。個別の観光・飲食にも任意でマークを付けられるが、一律に予約必須とは判定しない。

名称変更・順序変更ではマークを保持する。場所・経路・宿・日時等の予定内容の置換では解除し、relative日程のcalendar binding変更でも解除する。マークだけの変更では予定の確定・旅程採用意思・費用観測を無効化しない。旅程分岐・公式しおりの公開 / 取り込みにはマークを引き継がない。

AIのTrip / focused-item / get_trip_items投影は同じbookingStatusとuser-mark-not-provider-verifiedという意味を渡す。予約記録・Provider確認済みの状態として扱わない。

検証はtrip-booking.test.ts、trip-workspace.test.ts、trip-booking-persistence.test.tsを参照する。
