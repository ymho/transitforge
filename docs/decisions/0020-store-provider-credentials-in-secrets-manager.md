# ADR 0020: 外部旅行提供者の認証情報をSecrets Managerへ保存する

- ステータス: Accepted
- 日付: 2026-08-16

## 背景

楽天トラベルなどの外部旅行提供者はAI Lambdaから実行時に呼び出す。認証情報をGitHub Secretsへ置くと
CIでしか利用できず Lambdaは直接取得できない。ブラウザや`.env.local`へ置くと公開や端末外流出の危険がある。

## 決定

- 提供者ごとにAWS Secrets Managerのシークレットを作る
- 楽天トラベルは`/transitforge/dev/rakuten-travel`へJSONで保存する
- Terraformはシークレットの器とLambdaの`secretsmanager:GetSecretValue`だけを管理する
- シークレット値はTerraform state GitHub Actions Gitリポジトリへ保存しない
- LambdaへはシークレットARNだけを環境変数として渡す

## 影響

- 値の初回登録とローテーションはAWSコンソールまたはAWS CLIで行う
- ローカルのVite表示は楽天認証情報を必要としない
- 提供者アダプターはLambda内で必要なときだけシークレットを読む
