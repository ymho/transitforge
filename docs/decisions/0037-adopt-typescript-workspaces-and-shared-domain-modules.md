# ADR 0037: TypeScript workspaceと共有Domain moduleへ段階移行する

- ステータス: Accepted
- 日付: 2026-08-27
- 置換: ADR 0032 ADR 0034「Viewer UIをFeature単位で配置する」 ADR 0036

## 背景

RaiquoraはrootのVite Viewerと`services/agent-api`のPython Lambdaを同じrepositoryで管理する。
鉄道 経路 運行 旅行の決定論的な知識は両方から利用する一方 現在は実行環境と言語ごとに
`src/domain`と`services/agent-api/domain`へ分かれている。HTTP contractで不一致は検出できるが
同じ規則を二言語で維持する構成では正本を一つに保ちにくい。

また`src/application`はBrowser usecaseとAgent orchestrationを含み `src/features`と
`src/presentation`には画面責務が分散する。top-levelからFrontend Backend shared Domainの
実行境界と所有権を判別できない。

## 判断要因

- 決定論的なDomain Logicと契約の正本を一つにする
- FrontendとBackendの実行境界をtop-levelで判別できるようにする
- DomainからBrowser AWS Bedrock Mapbox Storage Providerへ依存させない
- AWS resource名 Terraform state address API path S3 key viewer-input契約を維持する
- 各段階でmainを動かし 単独でレビューとロールバックができるようにする
- 言語移行と機能変更を同じPRへ混在させない

## 選択肢

### 現在のTypeScriptとPythonの境界を維持する

変更量は小さいが同じDomainの型と規則を言語間contractで同期し続ける必要がある。

### BackendだけTypeScriptへ置き換えて現在のディレクトリを維持する

言語の重複は減るが Frontend Backend shared Domainの所有権がtop-levelから分からない問題は残る。

### TypeScript workspaceと共有Domain moduleへ段階移行する

移行量は大きいが 実行境界とDomain ownershipを分離し 同じ実装を両環境から利用できる。

## 決定

repositoryを単一lockfileのTypeScript workspaceとして段階移行する。

- Browser Applicationは`frontend`が所有する
- Lambda Applicationは`backend/agent-api`が所有し Node.js runtimeで実行する
- 鉄道 経路 運行 旅行の共有可能な契約と決定論的計算は`modules`が所有する
- Frontend固有usecaseは`frontend/src/usecases`へ置く
- Backend固有usecaseは`backend/agent-api/src/usecases`へ置く
- Browser HTTP Mapbox Bedrock S3 DynamoDB Secrets Manager Providerは各実行境界の`adapters`へ置く
- `main.ts`と`handler.ts`はComposition Rootまたはprotocol entrypointに限定する
- Domain非依存かつ両実行境界で共有する小さな処理だけをtop-level `lib`へ置く
- 空ディレクトリは作らず 実際の責務を移すPRでpackageを追加する

依存方向は次とする。

```text
frontend presentation -> frontend usecases -> modules/domain
frontend adapters --------------------------> modules/domain

backend handler -> backend usecases --------> modules/domain
backend adapters ---------------------------> modules/domain
```

Domainは外部Adapterをimportしない。Adapterはusecaseが定義するPortを実装する。

## 段階移行

移行順と各責務の撤去条件は
[TypeScript構成移行台帳](../architecture/typescript-migration-inventory.md)を正本とする。

Node Backendは全operationのcontract parityを確認するまでPython Lambdaと並行して構築する。
この期間の二重実装は移行検証だけに使い 新しい仕様を片方だけへ追加しない。
本番切替は既存Lambda resourceをin-placeでNode.js runtimeへ更新し dev確認後にPython実装を撤去する。

## 影響

### 良い影響

- Frontend Backend shared Domainの境界をpathとpackageで判別できる
- 経路 運行 旅行の決定論的な規則をTypeScriptで一意に所有できる
- 同じ型とfixtureをFrontend Backend Agent Evalから利用できる
- Vite固有依存とLambda固有依存をworkspace単位で管理できる

### 悪い影響

- Node Lambda bundleとAWS SDKの依存管理が必要になる
- 移行中は旧pathとPython実装を並行検証する期間がある
- 多数のimport test tool Terraform CI参照を段階的に更新する必要がある

### リスク

- 機械的な移動に機能変更が混ざると回帰原因を特定しにくい
- Python撤去前にNode parityを誤認すると経路や旅行検索が欠落する
- sharedの名目でUIやVendor都合を`modules`へ持ち込む可能性がある

## 確認

- rootからFrontend Backend modulesのtest build architecture checkを実行する
- versioned HTTP contractとjourney scenarioで言語移行前後を比較する
- Agent Smoke EvalとFull Evalを維持する
- Lambda package checkで生成物とhandlerを検証する
- Terraform planで既存resourceのreplaceがないことを確認する
- dev切替後に全operationのsmoke確認を行う

## 置き換えるADR

- [ADR 0032](0032-let-domain-own-core-contracts.md)の`src/domain`を正本とする配置判断
- [ADR 0034 Viewer UI](0034-organize-viewer-ui-by-feature.md)の`src/features`を正本とする配置判断
- [ADR 0036](0036-own-domain-logic-by-execution-boundary.md)のPythonとTypeScriptでDomain正本を分ける判断

[ADR 0034 本番Agent Runtime](0034-use-one-production-agent-runtime.md)の単一Runtime Tool Evidence
Trace Viewer Actionに関する判断は置き換えず 移行先のBackendで維持する。
