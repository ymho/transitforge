# ADR 0068: Agent Runtimeの実行責務をServer Applicationへ移す

- ステータス: Accepted
- 日付: 2026-09-18
- 関連: #476 #478、ADR 0019 0023 0026 0038 0044
- 部分置換: ADR 0038のBrowserでのproduction Runtime組成。単一Runtime、Evidence/Grounding、bounded loopの判断は維持する

## 背景

Browserがmodel/tool往復を組成すると、Agentの実行と表示・端末状態が結合する。
#483でViewer Actionと未使用経路は撤去済みだが、production cutoverは#480で行う。
移行中もAgentロジックをコピーして二重実装しない。

## 決定

- production Agent Runtimeの最終所有者はBackendとする。
- Provider非依存coreは`modules/agent/runtime`（`@raiquora/agent`）へ移設する。
  loop、limits、Tool Registry/Executor、Evidence mapper、Claim/Grounding、response contract、
  Trace、model-provider契約、構造化Contextとmodel class policyを単一実装として共有する。
  Agent orchestrationはDomain計算ではないため`domain`ディレクトリには置かない。
  既存workspace機構のみを使い、新しいframeworkや外部サービスは追加しない。
- `backend/agent-api/src/usecases/agent/server-agent.ts`の`runAgentTurn`をtransport非依存入口とする。
  trusted principal、生のuserRequest、conversation/trip参照、bounded UI参照を受けて
  `Promise<AgentRuntimeResult>`を返す。Registry/Executor/モデル会話はturnごとに作る。
- principalは最新mainの#484で導入された`TrustedPrincipal`契約を再利用する。形の検証は認証ではなく、呼出元がtrusted
  principalを渡す。既存`authenticatedApplication`から接続可能とし、JWT/Cognitoと公開routeの接続は#451、会話/Profile読込は#479が所有する。
  userRequestは8,000文字、参照は各200文字以内。未知の入力キーをscopeへコピーしない。
  現段階ではUI itemIdは参照としてscopeにだけ保持し、認可済みTripを未読込のままモデルの
  planning stateへ昇格させない。既存coreのcontext builderはモデル入力をさらにboundedにする。
- Server Adapterが既存`ConversationModel.converse`を同一processで呼ぶ。
  `BedrockConversationModel`がsystem prompt、AWS DTO、model選択、metadataを所有する。
  Decision Summaryの除去・検証も共有coreで行い、Browser実装をBackendからimportしない。
- 代表Toolは既存weather UsecaseとWeatherForecastProviderを接続する。
  Tool descriptorと外部Evidence変換はBrowserと同じ正本を使う。
  追加Toolはdescriptor、operation Port、Evidence mapperを登録する。
- ADR 0019の固定送信元IP要件は維持する。固定IPが必要なToolはoperation Portの先に閉じ、
  RuntimeへNAT/EIP/VPC依存を入れない。既存operationはキャンセル契約を持たないため
  Runtime timeout後も外部処理が継続し得る。今回の代表Toolは読み取り専用である。
  書込みToolの追加には認可・idempotency・キャンセル/遅着処理を別途設計する。
- BrowserはDOM/Mapbox/Three.js/LocalStorage、panel/tab/scroll、uiFocus取得、Viewer表示、
  presentation projectionを所有する。会話観測の端末キャッシュもBrowserに残す。
- transportは#462で決める。今回HTTP/SSE/WebSocket/Streamingや新しい公開入口を追加しない。

## 移行と検証

Browser production composition、HTTP Bedrock bridge、Browser側Tool/Trip状態と表示変換は
#480まで維持する。ただしRuntime coreは共有実装へ切り替える。#480でmodel/tool loopの実行を
Serverへ切り替え、Browser compositionとBedrock会話bridgeを撤去する。全Toolの移植と
production品質のFull/Live評価は今回の完了条件に含めない。

Server fake loopと既存Bedrock Adapter + weatherのoffline縦切り、複数Tool登録、Evidence/Claim、
重複、失敗、timeout/limit、turn間分離を検証する。共有coreの隣接testを正本に移し、
Browser境界のintegration testはBrowser側に残す。Backend workspace testがcoreも実行し、Frontend workspace testはcoreを除外して重複させない。architecture checkはcoreのBrowser/Vendor依存と
BackendからFrontendへの依存を拒否する。
