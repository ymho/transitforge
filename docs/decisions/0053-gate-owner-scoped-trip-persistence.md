# ADR 0053: owner-scoped Trip保存を認証・writer gateの内側に導入する

- ステータス: Accepted
- 日付: 2026-09-13
- 対象: #388、親 #382/#415、後続 #389

#389 で非 CAS replace と retry の制約を [ADR 0054](0054-commit-trip-mutations-atomically.md) により更新した。
以下は #388 導入時の記録。認証・公開 writer gate の決定は引き続き有効である。

## 背景と決定

現行 Agent HTTP event は authenticated end-user principal を持たない。CloudFront/OAC/IAM 保護だけを
利用者認可として扱えない。Trip V2 の Domain は既に導入されているが本番 source/writer は未有効である。

独立 UUID の同じ Trip を owner-scoped DynamoDB へ保存する Repository/Application 基盤を追加する。
新サービス/framework は増やさず既存 AWS SDK、Lambda、Domain validation を再利用する。
全操作に trusted server `TripPrincipal` を必須とし、PK 自体を owner scope にする。
認証 Adapter がない間は Trip public route を配線せず、handler default も 501 とする。

ADR 0052 の最終的な安全な server 正本化は維持するが、実装 ownership を最新 #388 とユーザー指示へ合わせる。
**#388 は CAS/expectedRevision/baseRevision/mutationId/idempotency primitive を実装しない。**
それらは全て #389。#388 の replace は内部の非 CAS 契約で、通常 UI writer を公開しない。
最終的に両 Issue と認証境界が揃ってから公開/移行 rollout を判断する。

## 選択と理由

- S3/LocalStorage を継続正本にする案より、owner key による scoped Query/更新と後続 CAS に適した
  DynamoDB を採用する。運行分析用 table を流用せず、利用者の Trip は専用 table とする。
- 一時的な default owner / body ownerId は採用しない。閉じた HTTP 入口と内部 principal 注入試験を選ぶ。
- UI は server read/preview only。非 CAS の保存ボタンを先に公開しない。
- migration は既存 pure converter だけを使い、固定 UUID の recovery attempt、read-back 確認、
  success marker、原本保持を分離する。並行 import の idempotency を保証するものではない。
- PITR/削除保護を有効にする。運行観測と違い旅行計画は再生成できないため、保存量相応の追加費用より回復性を優先する。

## 影響

ConversationSession は `tripId?` だけで Trip を参照し、会話削除/eviction は Trip を消さない。
archive と会話は別の寿命を持つ。source 所有権を読み込み成否から分離し、通信失敗時の legacy 二重 writer を防ぐ。
公開認証・認証切替・競合と再送・完全な legacy 撤去は未完成であることを UI/文書へ明示する。

契約、migration ownership、制約、AC は [実装記録](../architecture/trip-server-persistence.md)を参照する。
