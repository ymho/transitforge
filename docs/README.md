# ドキュメント索引

現行仕様はこの索引から読む。変更時の配置・統合・削除基準は[ドキュメンテーション方針](documentation-policy.md)に従う。コードと隣接テストが詳細な実行契約を所有する。

プロダクト概要 → 全体構成 → 対象の機能仕様 → 必要な運用手順の順に参照する。

## 製品と方針

- [KAIHO プロダクト概要](product-brief.md)
- [ドキュメンテーション方針](documentation-policy.md)

## 全体構成

- [Server Agentの実行境界](architecture/agent-runtime.md)
- [Regional REST Streaming](architecture/agent-streaming.md)
- [共通認証境界](architecture/authentication.md)
- [標準データモデル](architecture/domain-model.md)
- [Fixed-egress Accommodation Provider](architecture/fixed-egress-provider.md)
- [モジュール境界](architecture/module-boundaries.md)
- [設計原則](architecture/principles.md)
- [Agent・旅行案のSecurity / Privacy threat model](architecture/security-privacy.md)
- [Conversation / Profile Server保存](architecture/server-state.md)
- [MapboxとThree.jsによる列車描画](architecture/train-rendering.md)

## 機能仕様

- [V2の条件更新Tool](specs/agent-conditions.md)
- [Agent v2の構造化出力と公開境界](specs/agent-publication.md)
- [KAIHO ブランド表示](specs/brand.md)
- [取得済み事実による候補Assessment](specs/candidate-assessment.md)
- [相談と旅程の開始・継続](specs/consultation.md)
- [InTripContextSnapshot](specs/in-trip.md)
- [公式アカウントのしおり公開と取り込み](specs/official-guides.md)
- [Profile V3](specs/profile.md)
- [目的別旅行Tool](specs/travel-discovery.md)
- [宿泊候補と採用情報](specs/trip-accommodation.md)
- [予定の予約マーク](specs/trip-booking-marks.md)
- [TripRequest / PlanAssumption](specs/trip-conditions.md)
- [原通貨Moneyと価格観測](specs/trip-costs.md)
- [Trip Feasibility](specs/trip-feasibility.md)
- [鉄道TripImpact](specs/trip-impacts.md)
- [Trip V2 Activity](specs/trip-items.md)
- [Trip V2: 正本契約](specs/trip-model.md)
- [TripWatch / TravelEvent / TripImpact](specs/trip-monitoring.md)
- [Trip Notification runtime](specs/trip-notifications.md)
- [Trip Server保存](specs/trip-persistence.md)
- [Tripの訪問予定地点と表示要約](specs/trip-places.md)
- [Trip Readinessと旅行前準備](specs/trip-preparation.md)
- [Reservation](specs/trip-reservations.md)
- [Trip Schedule](specs/trip-schedule.md)
- [Trip sharing authorization](specs/trip-sharing.md)
- [旅程の保存済み天気](specs/trip-weather.md)
- [Trip workspace](specs/trip-workspace.md)

## 運用・検証

- [Agent v2 実環境運用と復旧](operations/agent-deployment.md)
- [Agent v2 テスト戦略 — greenfield acceptance](operations/testing.md)
- [Trip再チェックruntime](operations/trip-rechecks.md)

## データ

- [ビューワー入力仕様](data/viewer-input.md)

## 判断履歴

[ADR索引](decisions/README.md)は当時の判断理由を記録する。過去のgate、型、コマンド、名称を現行仕様と扱わない。

## 実行環境

- [開発入口](../README.md)
- [Agent API](../backend/agent-api/README.md)
- [Infrastructure](../infra/README.md)
- [dev環境](../infra/terraform/environments/dev/README.md)
