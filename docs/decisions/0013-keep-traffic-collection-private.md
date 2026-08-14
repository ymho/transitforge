# ADR 0013: 外部交通データの収集をprivate境界に置く

- ステータス: Accepted
- 日付: 2026-08-14
- 置換: ADR 0005 ADR 0008

## 背景

表示とAI分析には外部交通データが必要だが 取得処理や取得元の詳細を公開アプリに置く必要はない
公開クライアントから取得元へ接続すると利用者数に応じて負荷が増える

## 決定

- 取得 raw保存 正規化はprivateなdata-builderが担当する
- TransitForgeは同一オリジンに公開された正規化済みデータだけを読む
- ローカル開発では`viewer-input/congestion.json`と`viewer-input/delays.json`を読み
  存在しない場合はリアルタイム情報なしとして扱う
- S3アーカイブとDynamoDBサマリーはTransitForge側で維持し AI分析から参照する
- 取得元URL 収集Lambda Schedulerは公開リポジトリに置かない

## 影響

- 公開コードから取得元固有の実装を除外できる
- 収集周期と重複防止はdata-builder側で一元管理される
- 保存先の所有権は維持するため既存の分析データとTerraform stateを移動しない
