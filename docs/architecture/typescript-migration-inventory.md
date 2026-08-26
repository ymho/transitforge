# TypeScript構成移行完了記録

## 目的

この文書はIssue #203で完了した構成移行 対象責務 互換性の固定点を記録する。
新しい構成の判断は[ADR 0037](../decisions/0037-adopt-typescript-workspaces-and-shared-domain-modules.md)を正本とする。
2026-08-27にNode Lambdaのdev配備とPython Backend撤去まで完了した。

## 互換性の固定点

構成と言語の変更だけを理由に次を変更しない。

- AWS resource名とTerraform state address
- `/api/agent`を含むAPI path
- `conversation-feedback/` `agent-traces/`を含むS3 key
- Lambda環境変数名とIAMの対象resource
- `viewer-input`と`journey-search-v1`のwire contract
- LocalStorage keyと公開Viewer URL

## shared Domain

| 対象責務 | 現在の正本 | 移行先 | 移行Issue | 境界 |
| --- | --- | --- | --- | --- |
| 列車 駅 停車時刻 経路座標 | `modules/train/domain` | `modules/train/domain` | #206 完了 | JSON読込とMapbox変換は含めない |
| 駅名比較 業務時刻整形 | `modules/train/domain/station-name.ts` `route-time.ts` | `modules/train/domain` | #206 完了 | 表示文言の装飾はFrontendへ残す |
| 遅延 混雑 行き先変更 運休契約 | `modules/operation/domain` | `modules/operation/domain` | #207 完了 | S3 DynamoDB HTTPは含めない |
| 経路条件 区間 候補 比較 | `modules/journey/domain` | `modules/journey/domain` | #208 完了 | wire parseとUI projectionは含めない |
| 直通検索 CSA 乗換 遅延予測 | `modules/journey/domain/journey-search-engine.ts` | 同左 | #217 #220 完了 | Backendも同じshared Domainを利用 |
| 旅行候補 費用 旅程 Profile TripContext | `modules/trip/domain` | 同左 | #209 #218 #220 完了 | LocalStorageはFrontend Adapterが担当 |

## Frontend

| 対象責務 | 現在 | 移行先 | 移行Issue |
| --- | --- | --- | --- |
| Vite appとBrowser起動 | `frontend/src` `frontend/public` `frontend/vite.config.ts` | `frontend` workspace | #210 完了 |
| Concierge Trip Plan Train ViewerのViewとCSS | `frontend/src/presentation/<feature>` | `frontend/src/presentation` | #211 完了 |
| Three.js列車描画 | `frontend/src/presentation/train-viewer/rendering` | 同左 | #211 完了 |
| Viewer 会話 Agent clientのBrowser usecase | `frontend/src/usecases`と一部Feature | `frontend/src/usecases` | #212 完了 |
| Browser HTTP Mapbox Bedrock LocalStorage | `frontend/src/adapters` | `frontend/src/adapters` | #210 #212 完了 |
| Composition Root | `frontend/src/composition/viewer-composition.ts` | 同左 | #212 完了 |

`digital-twin-clock` `playback` `map-lighting` `weather` `train-visual-scale`などBrowser表示だけで
意味を持つ決定論的処理はshared Domainへ機械的に移さず Frontendのusecaseまたはpresentation所有とする。
会話Session 履歴 UI guidanceもBackend共有が必要になるまでFrontend所有とする。

## Backend

| operationまたは責務 | 現在 | 移行先 | 移行Issue |
| --- | --- | --- | --- |
| Lambda event HTTP応答 operation dispatch | `backend/agent-api/src/handler.ts`とusecases | 同左 | #213 #220 完了 |
| Feedback Agent Trace保存 | TypeScript usecaseとS3 Adapter | 同左 | #214 #220 完了 |
| Bedrock conversation Tool relay | TypeScript PortとBedrock Adapter | 同左 | #215 #220 完了 |
| 代表ダイヤ 遅延 混雑分析 | TypeScript Domain Usecase Adapter | 同左 | #216 #220 完了 |
| journey search | TypeScript usecaseと`modules/journey` | 同左 | #217 #220 完了 |
| accommodation searchと費用 | TypeScript usecase Adapterと`modules/trip` | 同左 | #218 #220 完了 |

## Infrastructureとtooling

| 対象 | 現在 | 移行先 | 移行Issue |
| --- | --- | --- | --- |
| Node依存とTypeScript設定 | npm workspaceと共通tsconfig | 同左 | #205 完了 |
| Lambda artifact | bundled Node.js artifact | 同左 | #219 完了 |
| Terraform Lambda runtime handler | Node.js runtimeとbundle handler | 同左 | #219 完了 |
| CI CD | workspace test build package check | 同左 | #205 #219 完了 |
| Python Backendと固有test | 撤去済み | TypeScript隣接test | #220 完了 |
| 最終文書と依存検査 | 現行path基準 | frontend backend modules基準 | #221 |

## 移行終了

一時的なPython Backendと旧architecture pathは#220と#221で撤去した。
現在の構成は[モジュール境界](module-boundaries.md)と[Domainの所有権](domain-ownership.md)を正本とする。

## 検証baseline

2026-08-27の移行完了時点で次を満たす。

- TypeScript 104 test file 396 test
- repository保守toolとinfraのPython 11 test
- Agent Smoke Eval 11/11
- Agent Full Eval 35/35
- architecture check成功
- Node Lambda package check成功

今後の変更はこのbaselineから意図しない能力低下がないことを確認する。

## workspace規約

- root `package-lock.json`を唯一のlockfileとする
- root `tsconfig.base.json`をTypeScriptのstrict option正本とする
- workspace候補は`frontend` `backend/*` `modules/*` `lib`に限定する
- 各workspaceは実コードを移すIssueで作成し 空packageを先に追加しない
- Browser依存とVite entrypointは`frontend` workspaceだけが所有する
- rootの`architecture:check`はworkspace構成と依存方向をまとめて検査する
- `backend/agent-api`の契約 Port Usecase HandlerはAWS SDK型へ依存せず Adapterで変換する
