# ADR 0057: 派生Readinessと独立した旅行前準備を分離する

- ステータス: Accepted
- 日付: 2026-09-13
- Issue: #392（親 #382 / #415）

## 背景と選択

「次に決めること」をチェックリストへコピーすると、経路未確定や予約不一致を手動doneで隠せてしまう。
逆に準備のopenをreadyの阻害要因にすると、成立済みの旅程を準備の都合で未完成へ戻してしまう。
Tripへ予約・準備の配列を埋め込む方式、LLMが総合完成度を保存する方式は採用しない。

## 決定

- Planning/BookingはTrip・TripRequest・既存Feasibility・ReservationFactのpureなread projectionとする。
  Feasibility codeとADR 0056の`blocksReady`を再利用し、別Completeness DSLを作らない。
- Checklistだけを独立resourceとし、schemaVersion=1、独自item revisionを持つ。Trip.revisionとは無関係。
  ユーザー編集・done/reopen/not-needed・明示archive・関連先のlink/unlinkを保存する。
- AIはadd-only `ChecklistProposal`を生成する。preview後の明示確認だけが内部Applicationを呼ぶ。
  status/source/owner/private予約情報をTool入力にしない。派生問題を消すToolは公開しない。
- 同じDynamoDB tableのowner/Trip別namespaceを使う。Collection CAS metadataは並列add/rename時の
  exact dedupe用で、Trip状態ではない。item CASと同一transactionで更新し部分成功を返さない。
- category + NFKC/空白/ASCII大小文字正規化のexact titleだけで重複を防ぐ。意味的mergeはしない。
  完了・不要・archive・user項目も重複照合に含め、再提案で上書き/復活させない。
- Trip/Reservation変更とChecklistの分散transactionは作らない。新しい関連先は確認し、後から切れた
  参照はwarningを表示する。準備履歴は無言削除/再リンクしない。
- 公開writerは引き続きOFF。認証されたhostに明示供給したreader/writerのみ接続できる。
  新AWSサービス・認証方式・公開route・LocalStorage保存を追加しない。

## 影響

準備完了は成立性や予約確認の証明ではない。readyに非blocking unknownや未完了の準備が共存する。
Collection CASは異なる項目の同時編集でも競合し得るが、少量の個人準備リストで正確な重複防止を優先する。
競合/応答消失は再取得して確認し直す。既存sourceへ無条件retry/rebaseしない。
詳細・AC・後続境界は[旅行前Readiness](../architecture/trip-readiness.md)を参照する。
