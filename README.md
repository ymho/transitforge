# Raiquora

Agentic Transit Intelligence

実時刻表をもとに列車の計画位置を3D地図へ表示する個人開発プロジェクト

指定時刻に運行中の列車を動かしながら眺められるほか 混雑と遅延の表示 コンシェルジュによる列車案内と乗換3回までの経路検索に対応する

## 主な機能

- MapboxとThree.jsによる列車と全経路の3D表示
- 現在時刻への同期 手動時刻変更 再生速度変更
- 4時を境界とする業務日付と24時を超える時刻の処理
- 列車詳細 フォーカス 追跡 連結列車表示
- リアルタイム運行状況での混雑 遅延位置 行き先変更 運休
- リアルタイム運行状況と日時指定シミュレーターの切り替え
- 日時指定シミュレーターでの行先アーチ操作
- 天候と時間帯に応じた表示
- 気象庁の公式防災情報と駅から目的地までの徒歩 車移動 飲食店候補
- コンシェルジュによる列車検索 到着検索 直通または乗換3回までの経路検索
- 旅行プロフィールの出発地 同行者 好みに基づく個別の旅行提案
- UUIDで分けた会話セッションと端末内の旅程 継続的な好みの保存
- 新しい会話の開始と端末内に保存した過去の会話へのページ再読み込みを伴わない切り替え
- チャットと分離した移動 滞在 観光の旅程編集
- 乗換ペースと経路優先の保存 自然言語による検索単位の上書き
- 経路候補のタブ表示と路線色付きタイムライン
- 直前の経路に対する途中停車駅の質問と区間列車の変更
- 直前の経路を引き継いだ列車種別 列車名 特定列車の除外再検索
- 乗りたい列車や種別 鈍行限定 乗換条件を経路より先に伝える対話検索
- 混雑と遅延の履歴分析

経路検索は収録路線内の直通列車と乗換3回までの列車を対象とする
宿泊候補はコンシェルジュから日程と行き先を指定して検索できる
宿泊候補は地図上で評価 料金 空室状況を比較して旅程へ選択できる
日付別空室検索を設定していない環境では参考最安料金だけを表示し 空室を推測しない

## 開発環境

Node.jsのバージョンは`.nvmrc`を正とする
依存管理はrootのnpm workspaceと`package-lock.json`を正本にする
Viewerは`frontend` workspaceで実行する

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev
```

ローカルURLは`http://localhost:5173`を使う
`congestion.json`と`delays.json`がない場合は日時指定シミュレーターだけで起動する

旅程UIだけをAPIやBedrockなしで確認する場合は開発サーバーを起動して
`http://localhost:5173/?trip-preview=1`を開く。検索済み経路と宿泊候補を含むダミー旅程を表示し
LocalStorageの旅程は上書きしない。滞在カードの「地図で宿泊先を選ぶ」から 評価 参考料金
空室状況を含む固定候補を地図上で確認できる

Trip V2のread/proposal workspaceは`http://localhost:5173/?trip-workspace-preview=1`で確認する。
DesktopはTripとChatを並べ、Mobileは会話/旅程で切り替える。これはAPIなしのsynthetic previewであり、
変更案の確認はメモリ内のみ。本番のTrip V2保存はServer APIが正本で、legacy migrationは存在しない。
責務と確認方法は[Trip workspace](docs/architecture/trip-workspace.md)を参照する。

局地天気の見た目だけを外部APIなしで確認する場合は
`http://localhost:5173/?weather-preview=mixed`を開く
大阪付近を東西へ約1km動かすごとに 晴れ 曇り 雨が切り替わる固定データをMapboxのネイティブ表現で表示する
通常のURLではBackendから日本全体の天気を最初にまとめて取得し 地図移動時は最寄りの取得済み地点へ即座に切り替える
ズーム7以上では移動停止後に表示範囲を2×2から4×4で追加取得し 拡大するほど細かな現在値または予報へ切り替える

`.env.local`へMapboxの公開アクセストークンを設定する
ブラウザへ渡る値なので必要最小限の権限に限定し Gitへ追加しない

ローカル表示には`transitforge-data-builder`が生成した次のファイルが必要

```text
viewer-input/train_index.json
viewer-input/path_catalog.json
viewer-input/congestion.json
viewer-input/delays.json
```

入力形式は[ビューワー入力仕様](docs/data/viewer-input.md)を参照

## リポジトリ構成

```text
modules/train/       列車 駅 経路座標と業務時刻の共有Domain
modules/operation/   遅延 混雑 運休 行き先変更の共有Domain
modules/journey/     経路条件 候補 比較 直通検索の共有Domain
modules/trip/        旅行候補 費用 Profile TripContext 旅程の共有Domain
frontend/src/domain/          Viewerと端末内状態に閉じた決定論的な契約と計算
frontend/src/usecases/        ユースケースと外部境界のPort
frontend/src/adapters/        ブラウザ HTTP Mapbox Bedrockへの接続
frontend/src/presentation/    画面機能ごとのView CSS Three.js描画
frontend/src/composition/     Viewerの依存組成
backend/agent-api/  Node.js Agent APIの契約 Application Adapter Lambda entrypoint
infra/               パッケージ契約とTerraform
tests/               境界fixtureとrepository保守toolのPythonテスト
tools/               検証 評価 再生成コマンド
```

Agentの共通coreは`modules/agent/runtime/agent-runtime.ts`を唯一のモデル実行実装とする。
本番BrowserはCognito Access TokenでRegional RESTへ接続し、相談は常に`/api/agent-stream`を通る。
Conversationは`/api/conversations/v1`、Profileは`/api/profile/v1`、Trip V2は`/api/trips/v1`がServer正本である。
Bedrock・Server Tool・Evidence・Traceは`backend/agent-api`が所有する。Browser Agent Runtime、Browser Trip writer、
Browser起動時recheck、legacy migrationとそれらへのfallbackは存在しない。Browser storageはUI状態だけに限る。

本番Agent Lambdaは`backend/agent-api`のNode.js bundleを使う
TypeScriptのテストは対象モジュールの隣へ置く。repository保守toolとfixtureの更新方法は
[テストガイド](tests/README.md)を参照する。AWSリソース名など互換性に関わる
`transitforge`識別子は製品名とは分けて維持する

責務と依存方向は[モジュール境界](docs/architecture/module-boundaries.md)
計算の正本は[Domainの所有権](docs/architecture/domain-ownership.md)
移行結果は[TypeScript構成再編の完了監査](docs/architecture/typescript-reorganization-audit.md)を参照する

旅行機能の設計は [Trip V2契約](docs/architecture/trip-lifecycle.md)を参照する。Tripは会話と独立した
Server V2 resourceであり、Browserにlegacy TravelPlan/TripPlanのwriterやmigration原本は残さない。

#388の[Trip server保存基盤](docs/architecture/trip-server-persistence.md)はowner-scoped Repositoryと
認証済み公開Trip CRUDを提供する。CAS/冪等性はServer V2 writerで適用し、Browserのlegacy writerへ戻さない。

[#398 の Reservation](docs/architecture/trip-reservation.md)は採用済みTripとは独立した予約resourceとする。
内部のowner-scoped保存・変更確認・Workspace/Agent向けprivate値を除いたread projectionを実装した。
公開CRUDは認証gateの内側に閉じ、実予約・取消APIは実装しない。開発用Workspaceで5種類の予約状態を確認できる。

[#402 の Trip Feasibility](docs/architecture/trip-feasibility.md)は採用済み旅程を決定論的に
成立/不成立/未確認へ評価し、WorkspaceとAgentへ表示する。readyは変更後Tripの評価とCASを通す。
未知情報を成立と扱わず、本番writer・認証gateは引き続きOFFとする。

## 確認コマンド

[#393 の Trip monitoring](docs/architecture/trip-monitoring.md)は採用済み計画から独立したWatch、
外部Event、revision付きImpactの内部境界を提供する。
[#394 の鉄道Impact](docs/architecture/rail-trip-impact.md)は内部subject逆引き・決定論的評価・owner-scoped保存を追加する。
IAM-onlyの内部呼出seamであり、自律的な再チェック・利用者通知・public writerはまだ有効ではない。
[#408の天気・警報Impact](docs/architecture/weather-hazard-trip-impact.md)は同じ内部routing/保存を再利用し、
trustedな地域と旅程の時間精度に基づき暴露と未確認事項を記録する。自動再取得・通知はまだ有効ではない。

```bash
npm run architecture:check
npm run workspace:check
npm test
npm run build
python3 -m unittest discover -s tests -v
npm run lambda:check
npm run test:journey-scenarios
npm run eval:agent
npm run eval:agent:smoke
npm run eval:agent:full
npm run eval:agent -- --case cancelled-service
npm run eval:agent:model:live -- --strategy candidate --repetitions 3
npm run eval:agent:strategies
```

Agent Benchmarkは42件を収録し 曖昧要求 運休 遅延 制約 情報不足 複数Tool
のカテゴリ別に5指標を出す。失敗したcase IDは`--case`で単独再実行できる
戦略実験はsingle pass 結果駆動再計画 常時Reflectionの品質と相対コストを比較する

通常の`eval:agent`は再現可能な保存済みObservationを採点し CIの回帰検知に使う。
Browser Runtimeを直接起動するscripted Ask/Progressと旧decision Live Evalは#481 Batch 1で撤去した。
`eval:agent:model:live`は現行Server Agent、System Prompt、model class policyを使い、実Feedback由来の
会話品質3ケースを合成Provider結果で反復する。AWS認証と課金を伴うため、通常はGitHub Actionsの
`Agent Eval / Model Comparison`を手動実行する。固定アクセスキーは使わず、結果は14日保持のArtifactへ保存する。
この比較は本番model設定を変更しない。
Server Agentの実行契約は`backend/agent-api`のcomposition/tool testsで確認する。
過去のTrip Progress評価記録とthresholdは履歴として各architecture文書に残すが、現行コマンドではない。
公開の最新事実読取は既存end-user認証gate（501）を維持する。
会話Contextの保持と評価の限界は[会話品質監査](docs/architecture/conversation-quality-audit.md)を参照する。

経路検索のシナリオだけを確認する場合は次を実行する

```bash
npm run test:journey-scenarios
```

非公開S3から取得した会話Feedbackをローカルで匿名化・集約する場合は次を使う。
生会話は標準出力とreportへ出さず `reports/`はGit管理対象外とする。

```bash
python3 tools/analyze_conversation_feedback.py \
  --input-dir /path/to/private-feedback \
  --from 2026-08-01 --to 2026-08-31 --limit 200 --dry-run \
  --output-json reports/feedback.json \
  --output-markdown reports/feedback.md
```

分析済みclusterをIssue候補として確認する場合はExporterをdry-runで実行する。
作成時は人が確認したfingerprintだけを明示する。

```bash
python3 tools/export_feedback_issues.py reports/feedback.json
python3 tools/export_feedback_issues.py reports/feedback.json \
  --create --approved-fingerprint 0123456789abcdef
```

シナリオは`tests/fixtures/journey-search-scenarios.json`へ追加する
IDまたは名前を引数へ渡すと対象を絞り込める

入力データの規模を確認する場合は次を実行

```bash
python3 tools/measure_viewer_input.py \
  viewer-input/train_index.json \
  viewer-input/path_catalog.json
```

## データとAIの境界

- viewer inputの生成は`transitforge-data-builder`が担当
- 現在地の座標は最寄り駅の選択だけに使い AWSやモデルへ送信しない
- ブラウザやBedrockへ全履歴を渡さず Lambdaで決定的に絞り込む
- 利用者の暦日は4時境界で業務日付へ変換し 日付別の生成済みダイヤを検索する
- AIへ表示時刻変更 列車フォーカス レイヤー切替を公開せず 検索結果表示と手動地図操作を分離
- 外部Agent向けMCPは内部Agentと同じDomain Serviceを使い 読み取り専用の5能力だけを公開
- AWS認証情報や秘密値をソース Terraform変数ファイル stateへ保存しない

詳細は[プロダクト概要](docs/product-brief.md) [モジュール境界](docs/architecture/module-boundaries.md) [Domainの所有権](docs/architecture/domain-ownership.md) [標準データモデル](docs/architecture/domain-model.md) [コンシェルジュの境界](docs/architecture/ai-operations-guide.md) [Issue運用](.github/ISSUE_MANAGEMENT.md) [ADR](docs/decisions/README.md)を参照

## AWS

Cognito Access Tokenから既存Tripのownerへ接続する[共通認証境界](docs/architecture/authentication-boundary.md)を
Backendに用意している。公開APIへの接続、ログインUI、本番Trip writerはまだ有効化していない。

静的ビューワー AI Lambda 混雑と遅延の保存基盤をTerraformで管理する
継続的なデプロイはGitHub ActionsとOIDCを使用し 固定AWSアクセスキーを使わない

`CI / Test`はPRとmain revisionを検証する。`CD / Deploy`はmainのCI成功後または
mainからの手動実行だけでdev環境を更新する。両者は別Workflowとして権限と結果を分離する

環境固有の値はGitHub EnvironmentまたはGit管理外のローカル変数で与える
詳しい入口は[Terraform dev環境](infra/terraform/environments/dev/README.md)を参照

## ライセンス

ライセンス未設定
外部データや生成物をこのリポジトリへ含めない

## 利用者認証の段階導入

設定画面のログイン/新規登録はCognito Managed LoginとPKCEを使う。公開設定はTerraform出力から
配信する。未設定のローカル環境では認証なしでViewerを起動できる。
[認証境界](docs/architecture/authentication-boundary.md)と[SPA認証ADR](docs/decisions/0069-use-cognito-managed-login-for-spa.md)を参照する。
API route保護と本番切替は後続段階であり、ログインUIの導入だけで全API保護済みとはしない。

## Server Agent統合（#480）

[cutover統合とTool inventory](docs/architecture/server-agent-cutover.md)を正とする。
productionは認証済みREST streamからServer AgentのConversation turn・Context・Tool・final保存へ接続する。
Browser Agentへのfallbackはなく、Server Agent障害時は相談を停止する。
