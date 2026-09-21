# Server Agentの条件変更案（#455 / #456）

## 接続した経路

認証済みConversationのTripをContext Loaderがowner namespaceで取得した後、同じTripのsnapshotを
`propose_request_assumptions`へ渡す。Toolはモデル入力からTrip ID、revision、actorを受け取らない。
状態はrunAgentTurnごとに作り、別owner/会話/turnと共有しない。

既存のモデル用Request制約を`modules/trip/domain/model-request-proposal.ts`へ共通化した。
追加専用の`propose_request_assumptions`では既知条件・目的・人数・仮定の書換え/削除/確認は許さず、
新規解釈はmodel/unconfirmedの仮定とする。既知値の変更は下記の専用Toolへ分ける。
名称だけの希望とProviderで確認済みの場所を区別し、モデルが新しいProvider事実を作ることを拒否する。
ToolはTripを保存せず、正常なcompleted/follow_upだけに公開用`tripUpdateProposal`を付ける。
同じturn内の成功した案をpreviewへ累積し、元のTrip ID/revisionに対するrequest patch 1件へまとめる。
Tool結果のproposedRequestで現在の未保存案をモデルへ返す。失敗した呼出しはpreviewを変えない。
モデル本文からJSONを抽出しない。

## 保存済み条件を変更する提案

`propose_request_changes`は既知の条件を変更・解除したいという相談に対し、明示確認用の差分を作る。
旧`propose_request_assumptions`の追加専用制約は維持する。

- `replace_constraint` / `remove_constraint`は実在する旅行全体のconstraint IDを要求する。
  置換時はrequirementの種類を変えず、typed値とhard/softを検証する。無関係な条件を保持する。
- `set_party` / `clear_party`は今回人数の変更・解除、`set_goal` / `clear_goal`は目的の変更・解除。
  goalは仮定のsource fieldを持たないが、ここでも未保存の差分だけで、反映には利用者の確認が必要。
- 変更は1回8件まで、同一対象への重複指定を拒否する。変更のない置換を拒否し、既知値を
  無意味にmodel仮定へ格下げしない。全件検証に成功した場合だけ案を公開する。
- 新しい条件値と人数はApplication生成IDのmodel/unconfirmed仮定へ紐づける。
  モデルはsource、status、assumptionId、actorを供給しない。既存仮定の確認状態を変更しない。
  旧仮定から編集した対象への参照だけを外し、他の対象との関係は維持する。
- Providerで未確認の事実・座標を新設できない。既存の採用済みPlace再利用と名称だけの希望を区別する。
- 予定・予約・Profileを変更しない。日程希望の変更は採用済みscheduleを自動調整しない旨を確認画面に表示する。
- 生成→履歴→SSE→preview→認証済みCAS/read-backは仮置き案と共通である。
  同じ案の再送・再表示で自動採用せず、revisionが進んだ案の再適用を拒否する。

## 公開・保存契約

- 既存の本文finalにoptional `tripUpdateProposal`を追加する。過去の本文のみのreceipt/historyはそのまま読める。
- 公開対象は既存TripUpdateProposalのrequest patch 1件のみ。16 KiB UTF-8、summary 500文字、
  constraint/assumption各40件以下。unknown fieldや予定変更patchを拒否する。
- 現段階では旅行全体の条件のみ。item scope/予定に影響する仮定を含むRequestは公開しない。
  正本Tripのitemを使う集約検証は生成・preview・保存時に別途実施する。
- assistant本文・提案・完了receiptを既存の同じDynamoDB transactionで保存する。新しいtableは作らない。
  完了後の同一turn再送はモデルを再実行せず、本文と提案を再生する。
  同じattemptで本文が同じでも提案が異なるcompleteはconflict。
- 通常のConversation appendは引き続き本文専用。クライアントから提案を履歴へ注入する入力は拒否する。
- Trace、Tool入出力、Profile、principal、予約private値を公開する汎用artifact契約は作らない。
  Requestに既に保持された条件と、今回の条件変更案だけを公開する。
- SSEは保存完了後にfinalを送信し、Browserはdoneと正常なstream完了までfinalを表示しない。
  Browserの認証・会話・Trip/revision generation検査を維持する。

## 確認と再表示

新着の案は既存Trip workspaceのpreviewへ渡す。履歴の再表示では自動preview/保存しない。
「条件の変更案を確認」ボタンで同じ案を開き、利用者の明示確認後だけ既存の認証済みCAS writerで保存する。
Trip ID/baseRevisionが違う場合は再確認を求め、自動rebaseしない。採用後に旧案を開いても再適用できない。
仮置き案の保存と仮定そのものの確認/却下は既存の別操作を維持する。

履歴は最新metadataのmessageCountから末尾50件をseekし、DynamoDBのbyte page分割をたどる。
50件を超えた相談でも直近の提案を再取得できる。sequence欠落と途中のmetadata変更は部分成功にせず拒否する。
account/会話切替後の遅着応答も反映しない。

## 検証と残件

Domain/Tool境界、認可済みContext→Server Runtime→保存→再送、通信応答喪失、
公開append拒否、SSE受信、履歴再取得、DOMの明示review、古いrevision/別Trip拒否をoffline testで確認する。
既存Request編集とCAS/read-backの回帰試験も実行する。

全体テスト、Frontend/Backend build、architecture/workspace check、Agent Smokeを実行した。
Smokeは保存済み観測による回帰評価であり、実モデルのTool選択の保証ではない。
実Cognito/AWS/Bedrock、実ブラウザでの操作、paid Live Evalは未実施。インフラ変更はない。

item scopeを含む提案公開、
候補から実項目を含む仮旅程作成、実環境の複数Trip評価は残る。#454/#455/#456は完了扱いにしない。

## 旅程作成前の条件と引き継ぎ

旅程参照のないConversationは任意の`draftRequest: TripRequest`を持つ。
16KiB、条件・仮定各40件までとし、予定項目への参照は受け付けない。
`tripId`との同時保持は禁止する。条件ペインは同じ編集・差分表示を使い、
利用者の「確認して条件を保存」でConversationのrevision付き更新とread-backを行う。
描画用Trip形状は永続化しない。AIはサーバで読んだ条件を
`requestSource=conversation_draft`として受け取り、採用済みTripとは区別する。
条件の更新は実行中のブラウザ応答を失効させる。

「この相談から仮旅程を保存」はID・作成時刻・条件を固定し、Tripの作成と条件の
read-back後、Conversation APIのCASでtripIdの設定とdraftRequestの除去を同時に行う。
Trip APIの旧参照インデックスへのattachだけではAIの読むConversationは更新されないため、
この導線では使用しない。同じ画面セッション内の通信断の再試行は同じ作成内容を使い、既にリンク済みなら再作成しない。
再試行情報はメモリ内だけに保持するため、再読み込み後の未リンクコピーの自動回収は対象外である。
途中で条件・参照・アカウントが変われば引き継ぎを中止し、保存済みTripを自動削除しない。
作成後の競合では相談の条件を優先して残す。作成済みのコピーは旅程一覧から確認できる。
保存の再試行が未解決の間は、同じ画面から条件を変更できない。
「再試行をやめて条件を編集」で固定した保存操作を終了できる。
既存コピーを削除せず、次の明示的な仮保存は新しい旅程を作成することを画面で伝える。

旅程未作成時も、認可済みConversationの条件（未設定なら空のRequest）に対して
同じ2つの提案Toolを登録する。Trip形状は純粋な条件検証の内部入力としてのみ使い、
Agent ContextのcurrentTrip、Trip API、公開tripUpdateProposalへ出さない。
公開する`consultationRequestProposal`はconversationId、baseRequest、request、summaryのみ。
全体32KiB、前後のRequestは各16KiB、summaryは500文字以内とし、Trip用提案との同時指定を拒否する。
Toolから渡すIDや基準条件はモデル入力で指定できない。公開検証に失敗した案は累積previewにも残さない。

本文と同じtransactionでassistant messageとreceiptへ保存し、再送時は同じ案を返す。
通常appendからの提案注入は拒否する。履歴表示だけではpreviewや保存を行わず、
「条件の変更案を確認」で会話の条件ペインを開く。新着案は比較画面だけを開く。
保存には「確認して条件を保存」が必要で、仮定はmodel/unconfirmedのまま保持する。

会話のmessage保存もmetadata revisionを進めるため、案の基準はrevisionではなくbaseRequestとする。
previewで会話IDと現在条件の一致を確認し、保存時にもサーバから読んだ条件と照合する。
その最新metadata revisionでCASし、保存結果をread-backする。別会話・条件変更・Tripへの引き継ぎ後は拒否する。
条件の再確認は自由文の推測や自動rebaseで代替しない。更新応答喪失時は同じ保存内容のread-backで回復できる。

自由文を確認なしで永続化する機能ではない。候補・列車・宿の予定項目は仮保存で生成しない。
