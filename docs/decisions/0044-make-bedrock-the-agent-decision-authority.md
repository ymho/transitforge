# ADR 0044: BedrockをAgentの意思決定主体にする

- ステータス: Accepted
- 日付: 2026-08-30
- 関連: ADR 0021 0023 0026 0031 0033 0038

## 背景

本番Agentは共通`MultiStepAgentRuntime`からBedrock ConverseのTool Useを実行し Tool結果を
次のmodel callへ返している。一方 利用者の目的に応じた調査順序が`AgentPlanner`とSystem Prompt
Viewer Adapterの事前分岐へ散らばり Bedrockが意思決定する前に選択肢を狭めていた。

LLMへ事実計算を移さず 利用者の目的 制約 嗜好とEvidenceから何を調べ いつ質問し 何を勧めるかを
Bedrockへ集約する必要がある。

## 変更前の責務

| 要素 | 変更前の判断 |
| --- | --- |
| ProblemFramer | featureを固定intentへ変換 Viewer AdapterではContextを一つの自由文へ結合 |
| AgentPlanner | 旅行Toolを固定順に並べたplanをTrace用に生成 |
| System Prompt | 原則に加え 個別ケースとTool名を対応させる多数の分岐を保持 |
| Tool descriptor | APIの短い説明と入力schemaを提示 |
| MultiStepAgentRuntime | bounded loop Tool実行 Evidence Claim Viewer Action検証 結果駆動replan |
| Bedrock Adapter | Converse DTO変換 System Prompt付与 metadata正規化 |

## 決定

BedrockをAgentの意思決定主体とする。Domain Toolを検証可能な事実の正本とし
Application RuntimeはContext構築 Tool実行 Evidence Policy 安全制約と観測を担う。

### Bedrockへ渡す判断

- 利用者のgoalの解釈
- hard constraintとsoft preferenceの区別
- 必要なEvidenceと能力の選択
- 追加質問 Tool実行 回答の選択
- Tool結果を受けた再計画
- 候補のtrade-offと最終推薦

### 決定論的コードへ残す判断

- 時刻表 経路 乗換 遅延 混雑 外部Providerの事実計算
- Tool input outputのschema validation
- Evidence生成 Claim grounding
- Viewer Actionのallowlist task scope検証
- 認可 privacy safety side effectの境界
- timeout model call Tool call iteration Evidenceの上限

### Context

`AgentDecisionContext`はuser request feature UI context 関連会話 TripContext Travel Profile
現在旅程 直前の検証済み経路 検証済み事実 既知hard constraint 既知soft preference 過去Tool結果 利用可能能力を
別フィールドで扱う。現在地座標 秘密値 内部ID 大量履歴を含めない。

`AgentDecisionContext`のBuilderがContextをboundedに構築してモデルへ渡す。
独立した`ProblemFramer`は自然言語分類も実行判断も担わない薄い中継になったため削除する。
deterministicに確定した条件だけをknown constraintへ入れ 意味解釈はBedrockに委ねる。

### PlannerとPrompt

独立した`AgentPlanner`も実行の正本ではなく定型Traceを返すだけになったため削除する。
RuntimeはBedrockと決定論的Policyの責任境界だけをTraceへ記録し 実際の行動順序はTool Useを正本とする。
System Promptはsafety privacy grounding 会話原則 Viewer Action境界を正本とし
個別Toolの適用条件は能力contractへ移す。

Tool capability contractは能力 適するケース 適さないケース 返すEvidence 鮮度 制約
責任境界を記述し Bedrock向けdescriptionへboundedに変換する。入力parserとDomain実装は引き続き
実行可否と事実計算の正本である。

### Decision Trace

内部Chain-of-Thoughtは要求 保存 表示しない。Traceには観測可能な判断結果だけを記録する。

- interpreted goal
- known hard constraints
- known soft preferences
- selected action
- selected tool
- unresolved facts
- reason code
- replan reason

初期段階では実際に選択されたToolまたは回答から観測できるDecisionを記録する。
モデル固有の内部推論を復元しない。将来モデルが外部化可能なDecision Summaryを返す場合も
別schemaで検証し Traceへ保存する。

### Replan

ADR 0031の結果駆動replanを維持する。Tool結果を同じ会話へ返し Bedrockが次の能力または回答を
判断する。Reflection専用model callは追加しない。

## 段階移行

最初の変更ではContext contract Planner縮小 Prompt原則化 主要Tool descriptor Decision Traceを導入した。
後続整理で中継だけになったProblemFramerとPlannerを削除し 利用者の生の入力とTripContextを
別フィールドでRuntimeへ渡すようにした。会話UIはContextを自然言語promptへ埋め込まない。
後続の[ADR 0045](0045-expose-tools-by-capability-availability.md)で Viewer Adapterの旅行ケース別
Tool公開制限と業務順序を強制する`finalResponsePolicy`を削除した。Tool公開はAdapter 現在旅程
side effect Portの利用可能性だけで決める。

さらにコンシェルジュ入口の`feature`は発話の正規表現分類ではなくUI contextの`concierge`を
使用する。追加質問の種類はAdapterが別の質問へ置換せずBedrockが選択し、既知条件の聞き直しは
一般的なTool precondition違反として結果駆動replanへ返す。駅間が明示された経路など
deterministicに確定できる入力は引き続きTool入力の正本として扱う。

直前の経路に関する列車照会と利用・回避条件は、Bedrockより前の文字列分岐で回答せず、
boundedな`currentJourney`と`inspect_previous_journey` `revise_previous_journey`能力として渡す。経路Toolは
モデルが構造化した列車種別・列車名・乗換条件も受け取り、値を検証して決定論的に検索する。
運賃・座席希望や経路条件だけの発話へ固定文を返していたComposition分岐も廃止し、
回答・質問・Tool選択をBedrockへ委ねる。途中駅照会、区間の代替候補検索、提示済み候補の
確定も同じ能力の構造化actionへ統合する。Compositionは直前旅程と提示中候補の会話単位state、
Domain Portの接続だけを担い、発話の文字列から操作を選ばない。候補列車はTool結果のEvidenceへ
変換し、モデルが選択した事実と決定論的な検索結果を追跡できるようにする。

常時二層のmodel callは行わない。コンシェルジュRuntimeは文字列ルーターを追加せず`decision`
capability classを要求し 設定がなければ既定modelへフォールバックする。物理modelの格上げは
同じLive Evalで品質とコストを比較してから環境設定で行う。

2026-09-02にLive EvalをFull 11件、Smoke 6件へ拡張した。既定Nova LiteはSmoke 3/6、
Full 4/11だった。JP Claude Haiku 4.5とJP Claude Sonnet 4.5もSmoke 3/6で、Novaが通す
旅行開始ケースとClaudeが通す直前経路・結果駆動replanケースが補完関係になった。
Haikuは平均model latency 3.2秒、Sonnetは6.0秒で、Novaの1.3秒より遅くtokenも増えた。
単純な物理modelの格上げや常時二層化では品質を改善できないため採用しない。失敗caseは削らず、
同一datasetで全領域の品質改善を確認できた変更だけを採用する。

## 既存ADRとの関係

- ADR 0021のTool境界を能力contractへ拡張し Domain Logicをモデルへ移さない
- ADR 0023のbounded Runtimeと責務分離を維持する
- ADR 0026のEvidence Claim Viewer Action検証を変更しない
- ADR 0031の結果駆動replanを維持し常時Reflectionを追加しない
- ADR 0033はADR 0038で置換済みであり 配置の正本はADR 0038とする
- ADR 0038の単一本番Runtimeを維持し 別Planner Runtimeを新設しない

## 影響

### 良い影響

- 新しい旅行ケースごとにSystem Promptへif文を追加する必要が減る
- Bedrockへ渡した既知条件と能力をTrace Evalで確認できる
- Profileと今回条件 Tool結果を同じ意思決定Contextで扱える
- Tool選択の自由度を上げても事実性とViewer安全性は決定論的に維持できる

### リスク

- descriptorが曖昧だと不要なTool callや質問が増える
- Contextが大きいとtoken latencyが増える
- 移行期間はViewer Adapterの事前分岐とBedrock判断が重複する

Contextとdescriptorは件数 文字数を制限する。Smoke EvalとFull EvalでTool Selection
Constraint Grounding Task Completion Viewer Actionに加え model call Tool call latency tokenを比較する。

## 確認

- `npm test`
- `npm run build`
- `npm run architecture:check`
- `npm run workspace:check`
- `npm run eval:agent:smoke`
- 必要に応じて`npm run eval:agent:full`
