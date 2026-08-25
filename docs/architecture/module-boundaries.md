# モジュール境界

## 目的

コードを技術ではなく責務から探せる状態にし 変更理由の異なるモジュールを分離する
この文書は移行中の目標構成とimport方向の正本である

## 目標構成

```text
src/
  domain/          鉄道 運行 経路 旅行のモデルと決定論的な規則
  application/     Agent Viewer 旅程のユースケースとPort
  features/        Concierge Trip Plan Train Viewerの機能単位の接続
  adapters/        Browser HTTP Bedrock Mapbox Storageの実装
  presentation/    状態を所有しないViewと小さなUI部品
  rendering/       Mapbox Three.jsによる描画
  infrastructure/  MCPなどprocess境界の入口
  observability/   実行時の計測
  main.ts           起動と依存注入だけを行うComposition Root

services/
  agent-api/        Agentと旅行検索のBackend Application
  traffic-collectors/ 運行情報を収集するBackend Application

infra/
  terraform/        AWS構成と環境差分
  packaging/        servicesからデプロイ成果物を作る定義
```

空のディレクトリを先に作らず 責務を抽出するPRで必要な配置を追加する
AWSリソース名 API path viewer-input形式はフォルダ移動を理由に変更しない

## 依存方向

| 呼び出し元 | 依存してよい対象 | 依存してはいけない対象 |
| --- | --- | --- |
| Domain | Domainと標準ライブラリ | DOM Storage 通信 Vendor UI Infrastructure |
| Application | DomainとApplication Port | Vendor実装 DOMの具体型 Terraform |
| Features | Application Domain Presentation | Data Loader Infrastructure Renderingの具体型 |
| Adapters | Domain Application 外部SDK | PresentationとFeature状態 |
| Presentation | Domainの表示用値とUI部品 | 通信 Storage Infrastructure |
| Rendering | Domainの描画用値と描画SDK | Conciergeや旅程のFeature状態 |
| Infrastructure | ApplicationとDomainの公開契約 | PresentationとRendering |

外側から内側へ依存する。Domainは最も内側に置き 外部サービスの都合を持ち込まない
Agentは推論とToolのオーケストレーションを担当し 鉄道の計算はDomain Serviceへ委譲する

## 契約の所有者

- `Train` `TrainStop` `Journey` `Operation`はDomainが所有する
- JSON HTTP Bedrock AWSイベントの形式はAdapterが所有する
- Adapterは外部形式をDomain契約へ変換する
- Viewer ActionはApplication Portを通してPresentationとRenderingへ適用する
- `main.ts`とLambda handlerは実装を持たず依存を組み立てる

### Viewer起動の責務

| 責務 | 所有するモジュール |
| --- | --- |
| 必須DOM参照の取得と検証 | `application/viewer/viewer-elements.ts` |
| 表示日時と日時ピッカー | `features/train-viewer/date-time-control.ts` |
| 再生とデジタルツイン同期 | `features/train-viewer/playback-controls.ts` |
| 天気 表示モード 行先アーチ | `features/train-viewer/map-controls.ts` |
| 混雑と遅延の定期更新 | `features/train-viewer/realtime-updates.ts` |
| HTTP Browser Mapbox実装の注入 | `main.ts` |

Feature側は通信やMapboxの具体実装を生成しない
`main.ts`がAdapterを注入することでコントローラをMapbox実体なしで検証できるようにする
style再読込時は前回の定期更新を破棄してから新しい購読を開始する

## 移行中の例外

`npm run architecture:check`は新しい逆向き依存を拒否する
既に存在する違反だけを`tools/check_architecture_boundaries.mjs`へ移行Issue付きで列挙する

- #159 Feature UIの再編

例外が不要になった場合は同じPRでallowlistから削除する
例外だけが残った場合も検査を失敗させるため 恒久的な抜け道として利用しない

## 変更時の確認

```bash
npm run architecture:check
npm test
npm run build
```

新しいサービス Vendor SDK 状態管理方式を追加する場合は 先に責務と依存方向をADRへ記録する
