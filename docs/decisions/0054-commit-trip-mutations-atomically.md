# ADR 0054: Trip mutation を revision CAS と receipt で原子的に保存する

- ステータス: Accepted
- 日付: 2026-09-13
- 対象: #389、親 #382/#415、前提 #388/#390

## 決定

既存 Trip の schemaVersion 2 / revision を再利用し、同じ TripUpdateProposal に必須 baseRevision を追加する。
pure Domain preview は番号を維持し、server 保存時だけ N+1 と server Clock の updatedAt を設定する。
#388 の非 CAS replace は廃止する。

DynamoDB の 1 transaction で owner-scoped active Trip の revision 一致更新と、同 owner の mutation receipt を保存する。
receipt は別 item で digest と元の成功結果を保持する。Trip 本文へ無制限の履歴を追加しない。
receipt は自動失効させず、ID 再利用拒否と後日の同一結果返却を維持する。更新回数に応じた保管費用は増える。
既存 IAM の PutItem/UpdateItem 権限を使い、新サービス/認証 Provider/公開 route は導入しない。

## 代替案と理由

- read→比較→非条件 write は race を防げない。
- SDK の短期 ClientRequestToken だけでは永続的な retry/同 ID 異内容拒否を担えない。
- receipt と Trip の個別 write は partial failure で二重適用または成功記録欠落を生む。
- receipt を Trip 内配列へ積むと item 上限に到達する。別の bounded record を採用する。
- conflict の blind rebase/LLM merge は元の利用者確認を失う。最新 GET と再確認へ戻す。

## Migration / 公開 gate

旧 storage envelope は read 互換を維持し、revision 属性未導入時は old JSON 一致の CAS で最初の更新を行う。
既存 converter の初期 revision 0 は維持する。安定 UUID の create/import は同内容だけ冪等に成功する。
import は Web Locks と先行保存した pending marker で同じ端末のタブ/reload に対応する。原本を削除しない。
公開認証境界は未導入のため writer は OFF のまま。認証・採用再検証・CAS・冪等性・最新 GET を備える
trusted host の確認 seam のみ実装する。#399/#402 を先取りしない。

実装契約と適合試験は [Trip concurrency](../architecture/trip-concurrency.md) を参照する。
