# モジュール境界

## 目的

コードを技術ではなく責務から探せる状態にし 変更理由の異なるモジュールを分離する
この文書は移行中の目標構成とimport方向の正本である

Issue #203で採用した次期構成と段階移行は[ADR 0037](../decisions/0037-adopt-typescript-workspaces-and-shared-domain-modules.md)と
[TypeScript構成移行台帳](typescript-migration-inventory.md)を参照する。この文書は#221で移行完了後の構成へ置き換えるまで
現在稼働している境界を説明する。

## 目標構成

```text
frontend/src/
  domain/          鉄道 運行 経路 旅行のモデルと決定論的な規則
  usecases/        Agent Viewer 旅程のユースケースとPort
  features/        Concierge設定など画面へ渡す機能固有データ
  adapters/        Browser HTTP Bedrock Mapbox Storageの実装
  presentation/    機能別View CSS Mapbox Three.js描画
  composition/     外部実装 View Usecaseの依存組成
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
現在この公開repositoryが所有するBackend実装は`services/agent-api`である
交通収集の正本はprivateなdata-builder側にあり 公開側へ複製しない
Infrastructureの確認と障害調査は`infra/README.md`を正本とする

## 依存方向

| 呼び出し元 | 依存してよい対象 | 依存してはいけない対象 |
| --- | --- | --- |
| Domain | Domainと標準ライブラリ | DOM Storage 通信 Vendor UI Infrastructure |
| Usecases | DomainとUsecase Port | Vendor実装 DOMの具体型 Terraform |
| Features | Domainと固有設定 | Adapter Presentation Infrastructure |
| Adapters | Domain Usecases 外部SDK | PresentationとFeature状態 |
| Presentation | Usecases Domainの表示用値とUI部品 | 通信 Storage Infrastructure |
| Composition | Adapters Usecases Presentation Features | 業務計算の再実装 |

外側から内側へ依存する。Domainは最も内側に置き 外部サービスの都合を持ち込まない
Agentは推論とToolのオーケストレーションを担当し 鉄道の計算はDomain Serviceへ委譲する
TypeScriptとPythonをまたぐ正本と重複のルールは[Domainの所有権](domain-ownership.md)を参照する

## 契約の所有者

- `Train` `TrainStop` `Journey` `Operation`はDomainが所有する
- JSON HTTP Bedrock AWSイベントの形式はAdapterが所有する
- Adapterは外部形式をDomain契約へ変換する
- Viewer ActionはUsecase Portを通してPresentationとRenderingへ適用する
- `main.ts`とLambda handlerは実装を持たず依存を組み立てる

### Viewer起動の責務

| 責務 | 所有するモジュール |
| --- | --- |
| 必須DOM参照の取得と検証 | `usecases/viewer/viewer-elements.ts` |
| 表示日時と日時ピッカー | `presentation/train-viewer/date-time-control.ts` |
| 再生とデジタルツイン同期 | `presentation/train-viewer/playback-controls.ts` |
| 天気 表示モード 行先アーチ | `presentation/train-viewer/map-controls.ts` |
| 混雑と遅延の定期更新 | `usecases/train-viewer/realtime-updates.ts` |
| HTTP Browser Mapbox実装の注入 | `composition/viewer-composition.ts` |

Feature側は通信やMapboxの具体実装を生成しない
Composition RootがAdapterを注入することでコントローラをMapbox実体なしで検証できるようにする
style再読込時は前回の定期更新を破棄してから新しい購読を開始する

Viewer UIは`presentation`の機能別ディレクトリに置く

- `presentation/concierge`: 会話 プロフィール Landmark操作
- `presentation/trip-plan`: 旅程表示と編集提案
- `presentation/train-viewer`: 列車選択 詳細 時刻表 Three.js描画
- `presentation/shared`: Sheet遷移やLoading Screenなど複数画面で共有する小さなUI

CSSの所有範囲と表示比較は`docs/architecture/viewer-styles.md`を正本とする

## 移行中の例外

`npm run architecture:check`は新しい逆向き依存を拒否する
既に存在する違反だけを`tools/check_architecture_boundaries.mjs`へ移行Issue付きで列挙する
現在の例外はない

例外が不要になった場合は同じPRでallowlistから削除する
例外だけが残った場合も検査を失敗させるため 恒久的な抜け道として利用しない

## 変更時の確認

```bash
npm run architecture:check
npm test
npm run build
```

新しいサービス Vendor SDK 状態管理方式を追加する場合は 先に責務と依存方向をADRへ記録する
