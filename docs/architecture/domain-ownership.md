# Domainの所有権

## 目的

RaiquoraはブラウザのTypeScriptとAgent APIのPythonを併用する
この文書は同じ概念を両言語で別々に実装しないために 正本と境界契約を定める

所有権は言語ではなく実行責務で決める
LLMは曖昧な要求の理解とToolの選択を担い 鉄道と旅行の計算結果を生成しない

## 所有マトリクス

| 能力 | 正本 | 利用側と境界 | 整合性の確認 |
| --- | --- | --- | --- |
| 列車 停車時刻 経路座標と計画位置 | `src/domain/rail`とdata-builder生成入力 | Browser Adapterがviewer-inputをDomainへ変換 | TypeScriptの隣接テストとviewer-input fixture |
| 表示日時 業務時刻 列車フォーカス | `src/domain`と`src/application/viewer` | FeatureとRenderingがApplication Portを利用 | TypeScriptの隣接テスト |
| 経路検索の要求と応答 | `src/domain/journey-search-service.ts`のPort | HTTP AdapterがAgent APIのversioned contractへ変換 | Browser AdapterテストとPython request contractテスト |
| 直通検索 CSA 乗換判定 順位付け | `services/agent-api`のJourney Domain | `journey_search` operationとTool Adapterから利用 | Python unit testとjourney search scenario |
| 遅延予測 遅延と混雑の履歴分析 | `services/agent-api`のTraffic Domain | Agent Toolは集計済みの応答を変更せず利用 | Python unit testとAgent Eval |
| 旅行候補 宿泊の既知価格と費用集計 | `services/agent-api`のTravel Domain | 外部提供者Adapterが候補へ変換 | Python unit testとprovider contract test |
| Agent Tool Evidence Trace Policy | `src/application/agent` | Provider AdapterとViewer ApplicationがPortを実装 | TypeScript unit testとAgent Eval |
| HTTP Bedrock AWS 外部提供者の形式 | `src/adapters`と`services/agent-api`のAdapter | Domainへ変換してからApplicationへ渡す | Adapter contract testとLambda package check |
| 会話 プロフィール TripContext 旅程 | `src/domain`とBrowser Storage Port | `src/features/concierge`と`src/features/trip-plan`が利用 | TypeScript unit testとLocalStorage migration test |

## TypeScriptとPythonの境界

TypeScriptの`JourneySearchService`は経路計算の実装ではなくApplicationが依存するPortである
日付別の時刻表とprivateな運行データを使う決定論的な検索はAgent APIのPythonだけが実行する
ブラウザは返された候補を表示 比較 フォーカスできるが CSAや乗換判定を再実装しない

両言語の共有点は内部クラスではなくversioned HTTP contractである
TypeScriptは送受信時に契約を検証し Pythonは受信時と返却時に同じ制約を検証する
シナリオfixtureはアルゴリズムの共有実装ではなく 境界をまたぐ期待挙動の適合試験として扱う

## 重複を許容する範囲

- wire形式のparse serializeと入力検証
- Domain値から各画面へ変換する表示projection
- 同じfixtureを読む境界適合テスト
- Pythonの結果をTypeScriptのPortへ復元する型ガード

## 重複を禁止する範囲

- CSA 直通検索 乗換可否 順位付けのTypeScript再実装
- 遅延予測や混雑集計をAgent ToolやLLM promptで再計算すること
- 宿泊費の集計や不明価格の補完をPresentationで行うこと
- Provider固有payloadをDomain型として扱うこと
- Viewer Actionの検証をUIイベントごとに独自実装すること

## 移行中の扱い

旧Viewer Agentが使うブラウザ内の直通経路型と表示変換は移行期間だけ残す
新Runtimeへ接続した機能から順に`JourneySearchService`へ集約し 旧経路検索を拡張しない

Agent APIは外部APIとLambda entrypointを維持したまま Domain Application Adapterへ分ける
ファイル移動だけで責務が変わったことにせず 依存方向とテストで所有権を確認する

判断の背景は[ADR 0036](../decisions/0036-own-domain-logic-by-execution-boundary.md)を参照する
