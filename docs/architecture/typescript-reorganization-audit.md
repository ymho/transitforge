# TypeScript構成再編の完了監査

## 結論

Issue #203の構成再編は2026-08-27に完了した。
Frontend Backend shared Domain Infrastructureの実行境界をtop-levelで識別でき
Agent APIはTypeScriptのNode.js Lambdaへ切り替わった。
AWS resource名 Terraform state address `/api/agent` S3 key viewer-input形式は維持した。

## 受け入れ結果

- Frontendは`frontend` Backendは`backend/agent-api`が所有する
- 共有する列車 運行 経路 旅行の決定論的処理は`modules`が所有する
- Browser固有状態と表示計算だけを`frontend/src/domain`へ残した
- Backendの外部接続は`backend/agent-api/src/adapters`へ分離した
- Python Agent APIと固有テストを撤去し 二言語のDomain重複を解消した
- root npm workspaceと`package-lock.json`を依存管理の正本にした
- Node Lambdaは単一bundleを既存resourceへin-placeで配備した
- ADR 0032 0034 Viewer UI 0036の後継をADR 0037へ統一した
- Agent Runtimeの後継判断は重複番号を解消したADR 0038へ統一した

ADR 0037の背景にある`services/agent-api`とPython Lambdaの記述は当時の判断材料として残す。
現在の配置を示すREADME Architecture guideと検査対象には旧pathを残さない。

## 配置と依存

| 境界 | 所有する責務 | 外部接続 |
| --- | --- | --- |
| `modules/*/domain` | 共有契約と決定論的計算 | 禁止 |
| `frontend/src/usecases` | Viewer Agent 旅程のBrowser usecaseとPort | Adapter経由 |
| `frontend/src/presentation` | DOM CSS 表示変換 Three.js描画 | Usecase経由 |
| `frontend/src/adapters` | HTTP LocalStorage Mapbox Bedrock | 許可 |
| `backend/agent-api/src/usecases` | API operationと入力検証 | Port経由 |
| `backend/agent-api/src/adapters` | AWS SDK 外部HTTP Provider | 許可 |
| `infra` | AWS resourceとpackage契約 | Application実装を持たない |

## 配備監査

PR #237のCDでTerraform planとapplyが成功した。
既存Lambda名 Function URL IAM VPC 固定egress 環境変数を維持し
runtimeを`nodejs22.x` handlerを`index.handler`へ更新した。
生成packageは`index.mjs`だけを含み source map secret stateを含めない。

## 検証

完了時に次を実行する。

```bash
npm run architecture:check
npm test
npm run test:journey-scenarios
npm run build
npm run lambda:check
python3 -m unittest discover -s tests -v
npm run eval:agent:smoke
npm run eval:agent:full
terraform fmt -check -recursive infra/terraform
```

大容量の追跡対象はコンシェルジュ画像だけであり asset検査の対象とする。
生成したViewer Lambda bundle Terraform成果物 report secret credentialは追跡しない。
