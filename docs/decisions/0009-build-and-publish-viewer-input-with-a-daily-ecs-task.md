# 0009: viewer-inputを日次ECSタスクで生成してS3へ公開する

## Status

Accepted

## Context

`train_index.json`と`path_catalog.json`の軽量化を含む生成責務を
`transitforge-data-builder`へ集約した。TransitForgeのデプロイ時に元データを変換せず、
毎日更新された完成済みviewer-inputをWebビューワーから読めるようにする必要がある。

data-builderは時刻表取得、全国経路探索、大容量JSON生成を行うため、Lambdaの短時間・小容量実行より
コンテナバッチが適している。入力となる国土数値情報GeoJSONは自動取得せず、再配布もしない。

## Decision

- `transitforge-data-builder`をECRへ保存し、ECS Fargateの一回限りのタスクとして実行する。
- EventBridge Schedulerが毎日3:00（Asia/Tokyo）にタスクを開始する。
- 国土数値情報GeoJSONは専用の非公開・暗号化・バージョニング済みS3バケットへ手動配置する。
- タスクは起動時にGeoJSONを一時ストレージへ取得し、時刻表を取得して全件再生成する。
- 2つの出力が揃った場合だけ、Web用S3の`viewer-input/`へカタログ、列車インデックスの順で配置する。
- 公開オブジェクトには`Cache-Control: no-cache`を設定し、CloudFrontの`/viewer-input/*`も
  キャッシュしない。利用者は毎回S3上の現在値を読む。
- 取得元や経路生成の診断情報はコンテナの一時領域とCloudWatch Logsに留め、Web用S3へ公開しない。
- ECSタスクには入力2オブジェクトの読み取りと公開prefixへの書き込みだけを許可する。
- ECS、ECR、Scheduler、入力S3、VPCとそのIAMはdata-builderリポジトリの独立した
  Terraform stateで管理する。
- TransitForgeのTerraformはWeb用S3とCloudFrontに加え、data-builderのGitHub Actionsが
  専用stateをapplyするためのOIDCブートストラップロールだけを管理する。
- data-builderのGitHub Actionsはmain更新時にTerraformをapplyしてからECRへイメージを公開し、
  固定AWSキーを使用しない。ローカル端末からAWSリソースを継続的に更新しない。

## Consequences

- TransitForgeはデータ生成コードやデプロイ時変換を持たず、完成済み入力だけを読み込める。
- ビューワーのデプロイとデータ更新を独立して運用できる。
- data-builderは公開先S3バケット名だけを外部変数として受け取り、TransitForgeのstateを直接参照しない。
- FargateのCPU、メモリ、一時ストレージは全量実測後に調整する必要がある。
- GeoJSON年度更新時は、S3上の固定名オブジェクトを明示的に差し替える必要がある。
- 2ファイルの上書きは完全なトランザクションではない。カタログを先に置くことで、短い更新中に
  新しい列車インデックスが未配置のカタログを参照する状態を避ける。

## Alternatives

### TransitForgeのGitHub Actionsで変換する

アプリケーションのデプロイとデータ生成の責務が再び結合するため採用しない。

### Lambdaで生成する

全件経路探索の処理時間、メモリ、一時ディスク容量に適さないため採用しない。

### GeoJSONも自動ダウンロードする

配布元の更新・利用条件・ファイル選択を自動化の暗黙条件にしないため、初期段階では採用しない。
