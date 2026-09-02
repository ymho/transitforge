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
- 旅行プロフィールに応じたコンシェルジュの選定 アバター表示 口調の切り替え
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
frontend/src/features/        Concierge設定など画面へ渡す機能固有データ
frontend/src/adapters/        ブラウザ HTTP Mapbox Bedrockへの接続
frontend/src/presentation/    画面機能ごとのView CSS Three.js描画
frontend/src/composition/     Viewerの依存組成
backend/agent-api/  Node.js Agent APIの契約 Application Adapter Lambda entrypoint
infra/               パッケージ契約とTerraform
tests/               境界fixtureとrepository保守toolのPythonテスト
tools/               検証 評価 再生成コマンド
```

本番のコンシェルジュは`frontend/src/usecases/agent/agent-runtime.ts`を唯一のモデル実行入口とする。
Bedrock接続は`frontend/src/adapters/bedrock/viewer-agent-runtime.ts`で共通Tool Evidence Trace
Viewer Actionへ適合し ローカル開発用Agentは`frontend/src/usecases/agent/local-viewer-agent.ts`へ分離する。

本番Agent Lambdaは`backend/agent-api`のNode.js bundleを使う
TypeScriptのテストは対象モジュールの隣へ置く。repository保守toolとfixtureの更新方法は
[テストガイド](tests/README.md)を参照する。AWSリソース名など互換性に関わる
`transitforge`識別子は製品名とは分けて維持する

責務と依存方向は[モジュール境界](docs/architecture/module-boundaries.md)
計算の正本は[Domainの所有権](docs/architecture/domain-ownership.md)
移行結果は[TypeScript構成再編の完了監査](docs/architecture/typescript-reorganization-audit.md)を参照する

## 確認コマンド

```bash
npm run architecture:check
npm run workspace:check
npm run assets:check
npm test
npm run build
python3 -m unittest discover -s tests -v
npm run lambda:check
npm run test:journey-scenarios
npm run eval:agent
npm run eval:agent:smoke
npm run eval:agent:full
npm run eval:agent:decision:live -- --profile smoke --model-class default
npm run eval:agent:decision:live -- --profile smoke --model-class default --repetitions 3
npm run eval:agent -- --case cancelled-service
npm run eval:agent:strategies
```

Agent Benchmarkは42件を収録し 曖昧要求 運休 遅延 制約 情報不足 複数Tool
Viewer Actionのカテゴリ別に6指標を出す。失敗したcase IDは`--case`で単独再実行できる
戦略実験はsingle pass 結果駆動再計画 常時Reflectionの品質と相対コストを比較する

通常の`eval:agent`は再現可能な保存済みObservationを採点し CIの回帰検知に使う。
`eval:agent:decision:live`は本番と同じSystem Prompt Tool capability contract
`MultiStepAgentRuntime`からBedrockを実際に呼び、意思決定の単一model baselineを測る。
Live Evalは課金とAWS認証を伴うためCIでは実行せず、結果を`/tmp/raiquora-live-agent-eval`へ保存する。
`--profile full`と`--model-class default|lightweight|decision`を同じdatasetで実行してから
model routing比較へ渡す。モデルの非決定性を確認するときは`--repetitions 2..10`を指定し、
`agent-eval-stability.json`でcaseごとの成功率と全反復で成功したcase数を確認する。

```bash
aws sso login --profile <aws-profile>
AWS_PROFILE=<aws-profile> AWS_REGION=ap-northeast-1 \
  npm run eval:agent:decision:live -- \
  --profile full --model-class default --strategy single-default

npm run eval:agent:model-routing:build -- \
  --strategy single-default \
  --report /tmp/raiquora-live-agent-eval/single-default/agent-eval-report.json \
  --traces /tmp/raiquora-live-agent-eval/single-default/agent-eval-traces.json \
  --output /tmp/raiquora-live-agent-eval/single-default/run.json
```

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

静的ビューワー AI Lambda 混雑と遅延の保存基盤をTerraformで管理する
継続的なデプロイはGitHub ActionsとOIDCを使用し 固定AWSアクセスキーを使わない

`CI / Test`はPRとmain revisionを検証する。`CD / Deploy`はmainのCI成功後または
mainからの手動実行だけでdev環境を更新する。両者は別Workflowとして権限と結果を分離する

環境固有の値はGitHub EnvironmentまたはGit管理外のローカル変数で与える
詳しい入口は[Terraform dev環境](infra/terraform/environments/dev/README.md)を参照

## ライセンス

ライセンス未設定
外部データや生成物をこのリポジトリへ含めない
