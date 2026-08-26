# AGENTS.md

## 作業前

1. `README.md`を読む
2. `docs/product-brief.md`を読む
3. 関連するADRと仕様書を読む
4. 既存テストと開発コマンドを確認
5. リポジトリに答えがない場合は前提を明示

## 変更方針

- 変更範囲を1つの目的に絞る
- ドメインをUI ストレージ 通信 ベンダー実装から分離
- フレームワークやサービス追加時は理由をADRへ記録
- 秘密情報 個人情報 著作物 大容量生成物を追加しない
- 派生データはバージョン管理された入力から再生成可能にする
- 無関係な整形やリファクタリングを避ける
- 挙動 コマンド 契約 設計を変えた場合は文書を更新

## 配置判断

- 鉄道やAgentの決定論的な契約と計算は`frontend/src/domain`
- ユースケースと外部境界のPortは`frontend/src/application`
- 画面機能のView DOM操作 CSSは`frontend/src/presentation/<feature>`
- ブラウザ HTTP Mapbox Bedrockなど外部技術への接続は`frontend/src/adapters`
- Three.js固有の描画は`frontend/src/presentation/train-viewer/rendering`
- Agent APIのPythonコードは`services/agent-api` インフラ定義は`infra`
- TypeScriptテストは対象ファイルの隣へ置く
- Pythonサービスと境界を横断するテストは`tests`へ置き fixtureは`tests/fixtures/README.md`に従う
- 新規ファイルを慣習だけで`src`直下へ置かず 所有する責務を決めてから配置する

## 確認

完了前に次を行う

1. 文書化されたformat lint test buildを実行
2. 実行しなかった確認と理由を報告
3. 最終差分から無関係な変更を除外
4. 秘密情報と大容量生成物がないことを確認

## Git

- 明示依頼なしにcommit push merge release 履歴書き換えを行わない
- 保護されたデフォルトブランチで直接作業しない
- コミットは絵文字と自然な日本語で簡潔に書く
- PRタイトルと本文は日本語の常体で書く
