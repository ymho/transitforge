# Infrastructure

`infra`はAWS構成とデプロイpackageの契約だけを所有する
Agent 経路検索 旅行候補などのApplication実装は`services`へ置く

## 構成

- `terraform/bootstrap`: remote stateとGitHub Actions用の初期構成
- `terraform/environments/dev`: dev環境のAWS resource
- `packaging`: servicesからLambda artifactを作るmanifest

AWS resource名 state address API path S3 keyはフォルダ整理を理由に変更しない
package manifestはsourceとhandlerの正本であり Terraformとpackage testの両方から読む

## ローカル確認

```bash
python3 tools/build_lambda_package.py --check-only
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/bootstrap init -backend=false -input=false
terraform -chdir=infra/terraform/bootstrap validate
terraform -chdir=infra/terraform/environments/dev init -backend=false -input=false
terraform -chdir=infra/terraform/environments/dev validate
```

artifactを手元で確認するときだけ出力先を指定する

```bash
python3 tools/build_lambda_package.py --output /tmp/transitforge-agent-api.zip
unzip -l /tmp/transitforge-agent-api.zip
```

生成物はrepositoryへ追加しない
packageにはmanifestで許可したPython sourceだけを含め `__pycache__` bytecode secret stateを含めない

## Planとdeploy

devのPlanは既存backendと認証を設定して`infra/terraform/environments/dev`で実行する
フォルダ移動だけの変更ではLambda codeのin-place update以外にresource replaceがないことを確認する
replaceが出た場合はapplyせず state address resource名 provider差分を調べる

mainのCI成功後に`CD / Deploy`が同じrevisionをcheckoutし Terraform applyとViewer asset同期を行う
CIとCDはいずれもLambda packageを事前検証する

## 障害調査

- package失敗: `python3 tools/build_lambda_package.py --check-only`
- Terraform構文とprovider: `terraform validate`
- 予定外のresource差分: `terraform plan -refresh=false`
- Lambda起動失敗: handler名とzip rootの`handler.py`を確認
- Backend機能の回帰: `python3 -m unittest discover -s tests -v`

credential tfstate tfvarsの内容をIssue PR logへ貼らない
