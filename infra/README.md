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
- Lambda起動失敗: 対象`packaging/*.json`のhandlerとzip rootのbundle名を確認
- Backend機能の回帰: `npm test`

credential tfstate tfvarsの内容をIssue PR logへ貼らない

## Trip保存（Current）

`environments/dev/trips.tf`は専用owner-scoped DynamoDB table（on-demand/暗号化/PITR/削除保護）と
専用roleへのtable限定権限を定義する。公開routeは`agent-stream.tf`が既存Regional RESTの`POST /api/trips/v1`へ接続する。
Cognito authorizer / Backend verifier → TrustedPrincipal → 専用Trip API hostが本番writer / CASを提供する。
Conversation / Profile V3はpersonal-state host、相談はStrands v2専用stream hostに分離する。
Scan・Browser writer・legacy migrationを導入しない。詳細は[Trip保存](../docs/specs/trip-persistence.md)。
PITRは再生成できない計画の回復性を優先し、保存量に応じた費用を許容する。TTLで自動削除しない。

## TripChanged内部配送（#407）

`trip-changed.tf`はoutbox用sparse GSI、専用Lambda、1分の配送timer、起動失敗SQS DLQ、IAM、alarmを定義する。
Trip変更本体のretry/deadは同じDynamoDB内に期限なしで保持する。公開worker endpointは追加しない。
通常buildが`packaging/trip-changed.json`の別bundleを生成する。
運用・redriveと#394/#409への境界は[TripChanged配送](../docs/specs/trip-monitoring.md)を参照する。
