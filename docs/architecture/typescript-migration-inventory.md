# TypeScript構成移行台帳

## 目的

この文書はIssue #203で行う構成移行の現在地 対象責務 一時的な共存 撤去条件を追跡する。
新しい構成の判断は[ADR 0037](../decisions/0037-adopt-typescript-workspaces-and-shared-domain-modules.md)を正本とする。
移行完了までは現在の実装pathも有効であり ファイル移動だけで正本が変わったとは判断しない。

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
| 直通検索 CSA 乗換 遅延予測 | `services/agent-api/domain/journey` | `modules/journey/domain` | #217 | parity確認後にTypeScriptを正本化する |
| 旅行候補 費用 旅程 Profile TripContext | TypeScriptとPythonのTravel関連 | `modules/trip/domain` | #209 #218 | Provider payloadとLocalStorageは含めない |

## Frontend

| 対象責務 | 現在 | 移行先 | 移行Issue |
| --- | --- | --- | --- |
| Vite appとBrowser起動 | root `src` `public` `vite.config.ts` | `frontend` workspace | #210 |
| Concierge Trip Plan Train ViewerのViewとCSS | `src/features` `src/presentation` | `frontend/src/presentation` | #211 |
| Three.js列車描画 | `src/rendering` | `frontend/src/presentation/train-viewer/rendering` | #211 |
| Viewer 会話 Agent clientのBrowser usecase | `src/application`と一部Feature | `frontend/src/usecases` | #212 |
| Browser HTTP Mapbox Bedrock LocalStorage | `src/adapters` | `frontend/src/adapters` | #210 #212 |
| Composition Root | `src/main.ts` | `frontend/src/main.ts` | #210 #212 |

`digital-twin-clock` `playback` `map-lighting` `weather` `train-visual-scale`などBrowser表示だけで
意味を持つ決定論的処理はshared Domainへ機械的に移さず Frontendのusecaseまたはpresentation所有とする。
会話Session 履歴 UI guidanceもBackend共有が必要になるまでFrontend所有とする。

## Backend

| operationまたは責務 | 現在 | 移行先 | 移行Issue |
| --- | --- | --- | --- |
| Lambda event HTTP応答 operation dispatch | Python `handler.py` `agent_application.py` | `backend/agent-api/src/handler.ts`とusecases | #213 |
| Feedback Agent Trace保存 | Python storage module | TypeScript usecaseとS3 Adapter | #214 |
| Bedrock conversation Tool relay | Python Bedrock module | TypeScript usecaseとBedrock Adapter | #215 |
| 代表ダイヤ 遅延 混雑分析 | Python analysis module | TypeScript usecaseとS3 DynamoDB Adapter | #216 |
| journey search | Python Journey Domainとdispatcher | TypeScript usecaseと`modules/journey` | #217 |
| accommodation searchと費用 | Python Travel DomainとProvider | TypeScript usecase Adapterと`modules/trip` | #218 |

## Infrastructureとtooling

| 対象 | 現在 | 移行先 | 移行Issue |
| --- | --- | --- | --- |
| Node依存とTypeScript設定 | root単一package | npm workspaceと共通tsconfig | #205 |
| Lambda artifact | Python source zip | bundled Node.js artifact | #219 |
| Terraform Lambda runtime handler | `python3.12` `handler.lambda_handler` | Node.js runtimeとbundle handler | #219 |
| CI CD | root ViteとPython test | workspace test build package check | #205 #219 |
| Python Backendと固有test | `services/agent-api` `tests/services/agent_api` | TypeScript隣接test | #220 |
| 最終文書と依存検査 | 現行path基準 | frontend backend modules基準 | #221 |

## 一時的な共存と撤去条件

| 一時状態 | 許容理由 | 撤去条件 |
| --- | --- | --- |
| root Viewerとworkspace設定 | Frontendの一括移動を避ける | #210のbuildとtest成功 |
| PythonとNode Agent API | operationごとにcontract parityを確認する | #219のdev smoke成功 |
| PythonとTypeScriptのJourney Travel計算 | scenarioとfixtureで結果を比較する | #217 #218完了後 #220でPythonを削除 |
| 旧architecture pathの文書 | 移行中の実装を正しく説明する | #221で最終構成へ更新 |

共存期間に仕様変更が必要になった場合は新旧両方のcontract testを先に更新する。
片方だけへ機能を追加して二重実装を恒久化しない。

## 検証baseline

2026-08-27の移行開始時点で次を満たす。

- TypeScript 79 test file 336 test
- Python 80 test
- Agent Smoke Eval 11/11
- architecture check成功
- Python Lambda package check成功

各Issueは担当範囲の検証に加えて このbaselineから意図しない能力低下がないことを確認する。

## workspace規約

- root `package-lock.json`を唯一のlockfileとする
- root `tsconfig.base.json`をTypeScriptのstrict option正本とする
- workspace候補は`frontend` `backend/*` `modules/*` `lib`に限定する
- 各workspaceは実コードを移すIssueで作成し 空packageを先に追加しない
- 移行中のroot Viewerは#210までroot packageとして維持する
- rootの`architecture:check`はworkspace構成と依存方向をまとめて検査する
