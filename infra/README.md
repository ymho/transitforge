# Infrastructure

`infra`はAWS構成とデプロイpackageの契約だけを所有する
Agent 経路検索 旅行候補などのApplication実装は`backend`と`modules`へ置く

## 構成

- `terraform/bootstrap`: remote stateとGitHub Actions用の初期構成
- `terraform/environments/dev`: dev環境のAWS resource
- `packaging`: BackendからLambda artifactを作るmanifest

AWS resource名 state address API path S3 keyはフォルダ整理を理由に変更しない
package manifestはsourceとhandlerの正本であり Terraformとpackage testの両方から読む

## ローカル確認

```bash
npm run lambda:check
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/bootstrap init -backend=false -input=false
terraform -chdir=infra/terraform/bootstrap validate
terraform -chdir=infra/terraform/environments/dev init -backend=false -input=false
terraform -chdir=infra/terraform/environments/dev validate
```

artifactを手元で確認するときはbundleを生成して内容を確認する

```bash
npm run build --workspace @raiquora/agent-api
npm run lambda:check --workspace @raiquora/agent-api
```

生成物はrepositoryへ追加しない
packageにはmanifestで許可したNode.jsの単一bundleだけを含め secret state source mapを含めない

## Planとdeploy

devのPlanは既存backendと認証を設定して`infra/terraform/environments/dev`で実行する
フォルダ移動だけの変更ではLambda codeのin-place update以外にresource replaceがないことを確認する
replaceが出た場合はapplyせず state address resource名 provider差分を調べる

mainのCI成功後に`CD / Deploy`が同じrevisionをcheckoutし Terraform applyとViewer asset同期を行う
CIとCDはいずれもLambda packageを事前検証する

## 障害調査

- package失敗: `npm run lambda:check`
- Terraform構文とprovider: `terraform validate`
- 予定外のresource差分: `terraform plan -refresh=false`
- Lambda起動失敗: handler名とzip rootの`index.mjs`を確認
- Backend機能の回帰: `npm test`

credential tfstate tfvarsの内容をIssue PR logへ貼らない
