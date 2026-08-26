# Domainの所有権

## 目的

RaiquoraはTypeScriptを唯一のBackend正本とし 正本と境界契約をこの文書で定める

Issue #203ではBackendをTypeScriptへ統一し shared Domainを`modules`へ移す判断を採用した。
移行記録は[TypeScript構成移行台帳](typescript-migration-inventory.md)を参照する。

所有権は言語ではなく実行責務で決める
LLMは曖昧な要求の理解とToolの選択を担い 鉄道と旅行の計算結果を生成しない

## 所有マトリクス

| 能力 | 正本 | 利用側と境界 | 整合性の確認 |
| --- | --- | --- | --- |
| 列車 駅 停車時刻 経路座標と業務時刻 | `modules/train/domain`とdata-builder生成入力 | Browser Adapterがviewer-inputをDomainへ変換 | shared moduleの隣接テストとviewer-input fixture |
| 遅延 混雑 運休 行き先変更と列車への状態適用 | `modules/operation/domain`とdata-builder生成入力 | HTTP Adapterが外部payloadを検証してDomainへ変換 | shared moduleとtraffic Adapterの隣接テスト |
| 表示日時 業務時刻 列車フォーカス | `frontend/src/domain`と`frontend/src/usecases/viewer` | PresentationがUsecase Portを利用 | TypeScriptの隣接テスト |
| 経路条件 候補 比較 直通検索 CSA 乗換判定 順位付け | `modules/journey/domain` | Node Agent APIが日付別indexをAdapterから渡す | shared moduleとjourney search scenario |
| 遅延予測 遅延と混雑の履歴分析 | `modules/journey/domain`と`modules/operation/domain` | Agent Toolは計算済みの応答を変更せず利用 | shared module test Agent Eval |
| 旅行候補 既知価格の費用集計 Profile TripContext 旅程 | `modules/trip/domain` | Browser保存と外部Providerを境界の外へ分離 | shared module LocalStorage migration provider contractのテスト |
| Agent Tool Evidence Trace Policy | `frontend/src/usecases/agent` | Provider AdapterとViewer UsecaseがPortを実装 | TypeScript unit testとAgent Eval |
| HTTP Bedrock AWS 外部提供者の形式 | `frontend/src/adapters`と`backend/agent-api/src/adapters` | Domainへ変換してからUsecaseへ渡す | Adapter contract testとLambda package check |
| 会話Session 履歴と端末内保存 | `frontend/src/domain`とUsecase Repository | ConciergeとTrip PlanのPresentationが利用 | TypeScript unit testとLocalStorage migration test |

## BackendとDomainの境界

TypeScriptの`JourneySearchService`と探索engineは`modules/journey`が公開する正本である
日付別時刻表とprivateな運行データの取得だけをBackend Adapterへ分離する
ブラウザとLLMは返された候補を表示 比較 フォーカスできるが CSAや乗換判定を再実装しない

FrontendとBackendの共有点は内部クラスではなくversioned HTTP contractである
シナリオfixtureは境界をまたぐ期待挙動の適合試験として扱う

## 重複を許容する範囲

- wire形式のparse serializeと入力検証
- Domain値から各画面へ変換する表示projection
- 同じfixtureを読む境界適合テスト

## 重複を禁止する範囲

- CSA 直通検索 乗換可否 順位付けをFrontend AdapterやLLMへ再実装すること
- 遅延予測や混雑集計をAgent ToolやLLM promptで再計算すること
- 宿泊費の集計や不明価格の補完をPresentationで行うこと
- Provider固有payloadをDomain型として扱うこと
- Viewer Actionの検証をUIイベントごとに独自実装すること

## Agentからの利用

本番Agentは共通RuntimeのTool Adapterから`JourneySearchService`を利用する。
UI向けの経路 旅行 会話型への変換は鉄道探索を再実装せず 検証済みTool結果を投影する。

Agent APIは外部APIとLambda entrypointを維持したまま Domain Application Adapterへ分ける
ファイル移動だけで責務が変わったことにせず 依存方向とテストで所有権を確認する

判断の背景は[ADR 0036](../decisions/0036-own-domain-logic-by-execution-boundary.md)を参照する
