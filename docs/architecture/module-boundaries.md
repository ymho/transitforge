# モジュール境界

## 目的

コードを技術ではなく責務から探せる状態にし 変更理由の異なるモジュールを分離する
この文書は現在の構成とimport方向の正本である

Trip V2の移行先契約と責務分担は [Tripライフサイクル](trip-lifecycle.md)（#382/#415）を参照する。
Trip/TripRequest/Itineraryのpure契約は`modules/trip/domain`、BackendのTripRepository portは
既存規則に従い`backend/agent-api/src/ports`、CRUD/取込は`usecases`、DB/Browser/HTTPは各Adapterへ置く。
本設計採用だけでは新しいpackageやRepository実装を追加せず、旧型とV2を二重正本にしない。

Issue #203で採用した次期構成と段階移行は[ADR 0037](../decisions/0037-adopt-typescript-workspaces-and-shared-domain-modules.md)と
[TypeScript構成移行台帳](typescript-migration-inventory.md)を参照する。この文書は現在稼働している境界を説明する。

## 目標構成

```text
frontend/src/
  domain/          鉄道 運行 経路 旅行のモデルと決定論的な規則
  usecases/        Agent Viewer 旅程のユースケースとPort
  adapters/        Browser HTTP Bedrock Mapbox Storageの実装
  presentation/    機能別View CSS Mapbox Three.js描画
  composition/     外部実装 View Usecaseの依存組成
  observability/   実行時の計測
  main.ts           起動と依存注入だけを行うComposition Root

backend/
  agent-api/        Node.js Agent APIの契約 Application Port Adapter Lambda entrypoint

infra/
  terraform/        AWS構成と環境差分
  packaging/        backendからデプロイ成果物を作る定義
```

空のディレクトリを先に作らず 責務を抽出するPRで必要な配置を追加する
AWSリソース名 API path viewer-input形式はフォルダ移動を理由に変更しない
Node.js側ではAWS SDK型をAdapterより内側へ漏らさず handlerもApplication呼出しだけを担当する
交通収集の正本はprivateなdata-builder側にあり 公開側へ複製しない
Infrastructureの確認と障害調査は`infra/README.md`を正本とする

## Agent Runtimeの配置

[ADR 0068](../decisions/0068-place-agent-runtime-in-server-application.md)によりproduction Agentの
最終所有者はBackendとする。`modules/agent/runtime`はProvider非依存のApplication coreを所有し、
BrowserとServerが`@raiquora/agent/*`から同じloop/Evidence/Trace/response policyを参照する。
BackendはFrontendをimportせず、coreはBrowser API、Vendor、HTTP eventへ依存しない。
`backend/agent-api/src/usecases/agent`がtransport非依存turn入口とTool登録、
`server-agent-composition.ts`が既存ConversationModelとweatherを接続する。
固定IP ProviderはTool operation Portの先へ分離し、Runtime全体をVPCへ固定しない。
Browserのproduction組成とHTTP bridgeは#480まで残す。UI取得・表示・端末状態はBrowserに置く。

## Trip public writer の配置

`modules/trip/domain`がTrip V2/CASの決定論的契約を所有する。`backend/agent-api/src/usecases/trip-application.ts`と
owner-scoped repositoryがその契約を実行し、`trip-handler.ts`はHTTP requestを既存Application commandへ変換するだけに留める。
#451 の`trip-api-lambda.ts`/`trip-api-composition.ts`は`POST /api/trips/v1`だけを公開する専用composition rootであり、
Conversation/Profile の`personal-state` Lambda、Agent ingress、sharing/notification/in-trip workerと責務・IAM roleを共有しない。
Browser側の`HttpServerTripClient`は既存の`personalApiFetch`をtransportとして使い、LocalStorageの自動移行やdual-writeをしない。
Conversation metadataの`tripId`が唯一のTrip参照であり、旧TripPlan reader/writer・fallback・migration adapterは存在しない。

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
正本と重複のルールは[Domainの所有権](domain-ownership.md)を参照する

外部旅行情報も同じ依存方向を使う。`usecases/agent/external-travel-tools.ts`が
Browser Toolの入力検証と実行結果の収集を所有する。共有Evidence変換は
`@raiquora/agent/external-travel-evidence`へ委譲し、`adapters/bedrock`はモデル形式との変換を行う。
天気などの外部旅行情報カードは`presentation/concierge/external-travel-cards.ts`へ閉じる。
観光候補は`presentation/place-explorer`がカードを所有し `adapters/mapbox/place-media-layer.ts`が
同じPlace IDを地図へ投影する。チャット本体は外部Providerの応答構造やMapbox操作を解釈しない。

Backendでは宿泊 天気 Placeを別々のPortとAdapterとして組成する。同じSecrets Manager JSONを
互換性のため共有する場合も 宿泊 Mapbox SearchのCredentials Repositoryは分け
一方の必須項目を他方へ要求しない。PlaceはMapbox POIを地点の正本とし Wikipediaは説明と画像を補完する。
Web検索とページ読解も別PortとAdapterとして組成し Agent RuntimeやDomainへ検索ベンダー
HTML DNS Secrets Managerの具体型を漏らさない。Webで発見した候補はPlace検索へ名称を渡して照合する。

## 契約の所有者

- `Train` `TrainStop` `Journey` `Operation`はDomainが所有する
- JSON HTTP Bedrock AWSイベントの形式はAdapterが所有する
- Adapterは外部形式をDomain契約へ変換する
- Agent → Viewer Actionは廃止し、検索結果は構造化応答として表示する。手動操作とViewer → Agentのbounded contextは維持する
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
- `presentation/concierge/external-travel-cards.ts`: 外部旅行情報のEvidence付き会話内表示
- `presentation/place-explorer`: 検証済みPlaceの地図下部カードと選択状態
- `presentation/trip-plan`: 旅程表示と編集提案
- `presentation/train-viewer`: 列車選択 詳細 時刻表 Three.js描画
- `presentation/shared`: Sheet遷移やLoading Screenなど複数画面で共有する小さなUI

CSSの所有範囲と表示比較は`docs/architecture/viewer-styles.md`を正本とする

## 依存方向の例外

`npm run architecture:check`は新しい逆向き依存を拒否する
例外が必要な場合だけ`tools/check_architecture_boundaries.mjs`へ期限付きIssueとともに列挙する
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

## 宿泊Providerの固定出口（#480 Phase B）

[専用Provider境界](fixed-egress-provider.md)をdefault-offで追加した。
Serverは既存AccommodationProvider PortをLambdaAccommodationProviderへ差し替えられる。
宿泊入力検証はBackend contractsを共用し、Invoke DTO/HTTP検証/AWS SDKはadaptersへ閉じる。
専用Lambdaだけが宿泊credentialsとHttpAccommodationProviderを所有し、Tool/Evidence/Stateは移さない。
既存production組成は統合まで維持する。

## Regional REST Streaming構成（#480 Phase A）

ADR 0070の採用判断をdefault-offの環境構成へ接続した。
`agent-stream-lambda.ts`はVPC外のStreaming入口とし、transport adapterがHTTP/SSEの配送を所有する。
Server Agent Runtimeはtransport非依存のturn実行とTool組成を所有し、固定IPが必要な宿泊通信は
AccommodationProvider Portの先の専用Provider Lambdaへ分離する。Streaming Lambdaへ宿泊credentialsや
VPC依存を持ち込まない。両Lambdaのpackageは別artifactとしてbuild・検証し、接続とproduction切替は統合時に行う。
[Streaming構成と後続gate](agent-streaming-production.md)にTerraform、Lambda組成、認証、監視とcutover前の残作業を記録する。
