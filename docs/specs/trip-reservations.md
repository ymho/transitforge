# Reservation

## 正本と validation

`modules/trip/domain/reservation.ts` の独立 entity が唯一の予約状態の正本。

- id / tripId は UUID、tripId 必須。schemaVersion=1、初期 revision=0。
- itineraryItemId は optional、空白のみ不可・最大200文字。1 item に複数予約を持てる。
- kind: transport / accommodation / activity / restaurant / other。
- status: not-booked / booked / cancelled / not-required / unknown。
- provider は最大100文字、providerItemId と bookingReference は最大200文字。制御文字・未知 field を拒否する。
- providerItemId があれば provider が必要。ID は opaque。名称一致や Candidate ID から生成しない。
- bookedAt は明示 offset の instant。日付だけから時刻を補完しない。booked でも未取得なら省略可。
- startsAt/endsAt は optional な既存 ZonedInstant。offset/IANA zone、暦日、DST、end >= start を検証する。
  予約上確認できた固定時刻だけ保持する。Trip.schedule のコピー、日付から00:00生成、timezone推測はない。
- unknown は未予約確定ではない。Reservation 未登録も予約なしとは断定しない。
- change-required/confirmationStatus は追加しない。計画との不一致は #402 の派生評価。
- raw、bookingUrl、写真、review、旅客名・連絡先を受け付けない。費用/支払モデルも追加しない。

Trip と独立した revision を持ち、Reservation 更新だけでは Trip revision/updatedAt は変わらない。
取消は予約記録の status 更新であり、外部 Provider の予約取消を実行したという意味ではない。

## Application / import / private detail

`ReservationApplication` は全操作で trusted server TripPrincipal と owner-scoped active Trip を確認する。
create/import と link は linked item の存在も確認する。存在しない/別 owner/archived Trip は not-found。
item 削除後の既存予約は get/list/update/cancel/unlink できるが、存在しない item への新規 link は拒否する。
Trip archive 後は Application からの read/write を停止する。record は消さず復旧・将来の明示管理方針へ残す。

内部 command は create / get / list / update / cancel / link / unlink。入力は exact-key validation、
更新は baseRevision 必須。update.details は詳細の全置換であり、省略した optional detail は除去する。
id/tripId/revision/link を details 経由で変えられない。リンク操作と取消は専用 command を使う。
`preview` は検証済みの非 private projection と confirmationRequired を返す。書込はしない。

実行には別引数の trusted `ReservationAuthority.confirmed` が必要。モデルや body の authority は拒否する。
create/update の Provider identity・予約番号・予約固定時刻は retainedFields の明示許諾が必要。
Provider があれば既存 ExternalSourceEvidence / validatePlaceSource を使い、observed な出所と
provider/sourceId（商品IDがある場合）の一致も確認する。Evidence は trusted import host が渡す。
出所・許諾をモデルへ問い合わせて承認扱いしない。Evidence の構造検証だけで実際の予約を証明できるわけではなく、
実際の取得・手入力の確認・保存許諾判断は import/booking Adapter の責務である。現段階では実 Provider importer を配線しない。
この短命な許諾情報は予約本文や Agent へコピーしない。Provider data を manual と偽装しない。

get は明示的な所有者向け詳細取得で bookingReference を返せる。list / facts / mutation response / preview は
ReservationFact だけを返す。将来 UI detail を公開する場合も別の明示操作と認証が必須。
通常 card / Agent / analytics に private get 結果を使わない。SDK/validation エラーは定数カテゴリーへ変換し、
予約 payload・番号・Provider exception をログへ出さない。

## Persistence / CAS / retry

同じ暗号化・PITR・削除保護付き Trip table を使う。

`pk = OWNER#subject / sk = RESERVATION#tripId#reservationId`

storageVersion=1 の envelope に Reservation JSON と独立 revision を保存し、読込時に両番号と key を照合する。
Trip JSON、Conversation、mutation receipt に Reservation 配列を埋め込まない。Scan/delete API はない。
Query は owner + Trip prefix、consistent read、100件/page。全 page を読むか失敗する。最大1000件、
不正/循環 cursor・重複 ID・上限超過をエラーとし、保護用の予約を無言で省略しない。
一覧の concurrent update に対する snapshot isolation を保証するものではない。

create/import は stable UUID の conditional Put。同内容なら冪等、同 ID の別内容は already-exists。
更新は `attribute_exists(pk) AND revision = :base` の conditional Put。成功時のみ N+1。
並行更新は一方だけ成功する。欠落/古い番号を upsert しない。Trip の receipt を流用・複製せず、
Reservation では最小 CAS に留める。応答消失で成否不明なら GET して比較・再確認する。
同じ base の再送は競合し得るが二重適用しない。最新番号へ付け替えた blind retry/re-link は禁止。

内部 composition のみ追加する。Lambda route/認証 verifier/固定 owner/本番 UI writer は追加しない。
新しい AWS サービス、table、IAM action、Terraform 変更はない。

## Trip mutation の予約保護

TripRepository の prepare callback は非同期検証も受けられるようにした。同じ CAS/receipt のまま、
既存成功 receipt の回復後・新規 transaction 前に Application の ReservationReader を呼ぶ。
remove/replace がある場合、reader 未設定/取得失敗は unavailable として止める。
関連 booked 予約があれば confirmation-required（HTTP seam では409）。全 replace を保守的に対象とする。
名称変更だけの例外 router は追加しない。not-booked/cancelled/not-required/unknown は booked 保護の対象外で、
unknown が安全/成立を意味するわけではない。

確認 key は exact Proposal（Trip ID/baseRevision/patch/summary）と対象予約 ID/revision に結び付く。
trusted host が UI の明示確認から別引数として渡し、HTTP body/Agent 出力の key は受け付けない。
これは署名や認証 token ではない。認証済み host が本人の確認を確立することが前提であり、公開 host は未導入。
予約 revision が変われば再確認。Trip が変われば従来の CAS conflict。既存 receipt の retry は再変更しない。

Trip remove/replace は予約を一切変更・削除・付け替えない。元の予約記録と stable item link を残す。
remove 後は dangling link になり、list by Trip から引き続き参照できる。replace 後も元予約の記録であり、
新施設/新時刻の予約が取れたとは表示しない。旧予約の unlink/cancel と新予約登録は別確認操作。
同 ID の項目内容と予約が今も一致する保証は #402 の評価対象。

### 複数 resource の失敗と限界

- Trip 保存成功・予約変更失敗: Trip は保存済み、予約は元のまま。双方を再取得し別操作として確認する。
- 予約更新成功・Trip 更新競合: 予約は保存済み、Trip は他の更新のまま。自動 rollback/re-link しない。
- Trip 読取/item 存在検証と予約書込、予約照会と Trip transaction は一括 transaction ではない。
  その間の item 削除・新規予約追加等の race は残る。既存予約は失わないが cross-resource serializability は未保証。
  公開 writer rollout では認証とともに並行操作の再確認/transaction 方針をレビューする。
- 同じ Trip mutation は receipt で成功回復し、取消やリンク操作を副作用として再実行しない。
