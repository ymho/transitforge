# TransitForge

実時刻表をもとに列車の計画位置を3D地図へ表示する個人開発プロジェクト

指定時刻に運行中の列車を動かしながら眺められるほか 混雑と遅延の表示 コンシェルジュによる列車案内と乗換3回までの経路検索に対応する

## 主な機能

- MapboxとThree.jsによる列車と全経路の3D表示
- 現在時刻への同期 手動時刻変更 再生速度変更
- 4時を境界とする業務日付と24時を超える時刻の処理
- 列車詳細 フォーカス 追跡 連結列車表示
- デジタルツインモードでの混雑 遅延位置 行き先変更 運休
- デジタルツインモードとシミュレーションモードの切り替え
- 両モードでの行先アーチ表示
- 天候と時間帯に応じた表示
- コンシェルジュによる列車検索 到着検索 直通または乗換3回までの経路検索
- 旅行プロフィールに応じたコンシェルジュの選定 アバター表示 口調の切り替え
- UUIDで分けた会話セッションと端末内の旅程 継続的な好みの保存
- チャットと分離した移動 滞在 観光の旅程編集
- 乗換ペースと経路優先の保存 自然言語による検索単位の上書き
- 経路候補のタブ表示と路線色付きタイムライン
- 直前の経路に対する途中停車駅の質問と区間列車の変更
- 直前の経路を引き継いだ列車種別 列車名 特定列車の除外再検索
- 乗りたい列車や種別 鈍行限定 乗換条件を経路より先に伝える対話検索
- 混雑と遅延の履歴分析

経路検索は収録路線内の直通列車と乗換3回までの列車を対象とする
宿泊候補はコンシェルジュから日程と行き先を指定して検索できる
空室と日付別の料金は検索結果から推測しない

## 開発環境

Node.jsのバージョンは`.nvmrc`を正とする

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev
```

ローカルURLは`http://localhost:5173`を使う
`congestion.json`と`delays.json`がない場合はシミュレーションモードだけで起動する

旅程UIだけをAPIやBedrockなしで確認する場合は開発サーバーを起動して
`http://localhost:5173/?trip-preview=1`を開く。検索済み経路と宿泊候補を含むダミー旅程を表示し
LocalStorageの旅程は上書きしない

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

## 確認コマンド

```bash
npm test
npm run build
python3 -m unittest discover -s tests -v
npm run eval:agent
npm run eval:agent:smoke
npm run eval:agent:full
npm run eval:agent -- --case cancelled-service
npm run eval:agent:strategies
```

Agent Benchmarkは35件を収録し 曖昧要求 運休 遅延 制約 情報不足 複数Tool
Viewer Actionのカテゴリ別に6指標を出す。失敗したcase IDは`--case`で単独再実行できる
戦略実験はsingle pass 結果駆動再計画 常時Reflectionの品質と相対コストを比較する

経路検索のシナリオだけを読みやすい結果付きで確認する場合は次を実行する

```bash
python3 tools/run_journey_search_scenarios.py
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
- AIが実行できる画面操作は検証済みの可逆操作に限定
- 外部Agent向けMCPは内部Agentと同じDomain Serviceを使い 読み取り専用の5能力だけを公開
- AWS認証情報や秘密値をソース Terraform変数ファイル stateへ保存しない

詳細は[プロダクト概要](docs/product-brief.md) [標準データモデル](docs/architecture/domain-model.md) [コンシェルジュの境界](docs/architecture/ai-operations-guide.md) [Issue運用](.github/ISSUE_MANAGEMENT.md) [ADR](docs/decisions/README.md)を参照

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
