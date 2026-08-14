# TransitForge

実時刻表をもとに列車の計画位置を3D地図へ表示する個人開発プロジェクト

指定時刻に運行中の列車を動かしながら眺められるほか 混雑と遅延の表示 AI駅員による列車案内と直通経路検索に対応する

## 主な機能

- MapboxとThree.jsによる列車と全経路の3D表示
- 現在時刻への同期 手動時刻変更 再生速度変更
- 4時を境界とする業務日付と24時を超える時刻の処理
- 列車詳細 フォーカス 追跡 連結列車表示
- 混雑棒グラフ 遅延表示 行き先アーチ
- 天候と時間帯に応じた表示
- AI駅員による列車検索 到着検索 直通経路検索
- 混雑と遅延の履歴分析

経路検索はJR西日本内の直通列車を対象とする
乗換検索 宿泊 観光 予約は現時点の対象外

## 開発環境

Node.jsのバージョンは`.nvmrc`を正とする

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`へMapboxの公開アクセストークンを設定する
ブラウザへ渡る値なので必要最小限の権限に限定し Gitへ追加しない

ローカル表示には`transitforge-data-builder`が生成した次の2ファイルが必要

```text
viewer-input/train_index.json
viewer-input/path_catalog.json
```

入力形式は[ビューワー入力仕様](docs/data/viewer-input.md)を参照

## 確認コマンド

```bash
npm test
npm run build
python3 -m unittest discover -s tests -v
```

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
- AIが実行できる画面操作は検証済みの可逆操作に限定
- AWS認証情報や秘密値をソース Terraform変数ファイル stateへ保存しない

詳細は[プロダクト概要](docs/product-brief.md) [AI駅員の境界](docs/architecture/ai-operations-guide.md) [Issue運用](.github/ISSUE_MANAGEMENT.md) [ADR](docs/decisions/README.md)を参照

## AWS

静的ビューワー AI Lambda 混雑と遅延の収集基盤をTerraformで管理する
継続的なデプロイはGitHub ActionsとOIDCを使用し 固定AWSアクセスキーを使わない

環境固有の値はGitHub EnvironmentまたはGit管理外のローカル変数で与える
詳しい入口は[Terraform dev環境](infra/terraform/environments/dev/README.md)を参照

## ライセンス

ライセンス未設定
外部データや生成物をこのリポジトリへ含めない
