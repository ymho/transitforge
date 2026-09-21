# Trip指定相談・条件編集（#454 / #455 / #456）

## 今回の実装

- Home/一覧の「AIに相談」と「旅程を見る」は同じ明示Trip IDの読取・Conversation検索を通る。
  Conversationは全cursorページを調べ、同名のTripを名前で選ばない。最新の参照を再取得する。
  新規会話の作成が遅れても、別の明示遷移や認証切替を上書きしない。
- 会話切替直後に旧メッセージを外し、新履歴取得中は送信を停止する。既存stream generationと
  ProposalのtripId/baseRevision検査を維持する。入力とscrollは会話別UI状態である。
- #454の仮保存はUUIDに加えて作成日時も再試行中固定する（DynamoDB createの同一内容契約）。
  create後にTripをGETし、attach後にConversationをGETする。保存完了が遅れても別会話を開き直さない。
- 保存済みTripの目的、出発地、行き先、日程範囲、泊数/日数、人数/子どもの年齢、移動時間/乗換/車、
  ペース、予算、好み/避けたいことをPC右ペインとモバイルシートで編集する。未設定/解除は
  既存Requestの欠落として扱い、空の人数や年齢を推定しない。条件のhard/softを指定できる。
- 入力は既存TripRequestの検証とProposal previewを通る。明示確認で認証済みTrip APIのCASへ保存し、
  read-backで最新状態を表示する。画面用の別条件モデルやLocalStorage writerを追加しない。
- Profile由来/仮定/明示入力を区別する。編集・解除は対象constraintの相互参照のみ外し、関連itemの
  仮定は保持する。仮定承認/拒否は既存proposeAssumptionDecisionを使う。item修復が必要なら保存しない。
- Request変更で採用済みschedule・予約・Profileは変更しない。日程の希望と採用予定の区別を画面で示す。
  現行Server Agentは次turnでServer TripのRequestを読み直す。
- この接続で保存を許すpatchはrequest/titleのみ。candidate/evidence再解決・予約確認のない
  汎用のitinerary書込は有効化しない。

## Issueを完了にしない残件

[Server Agentの条件仮置き案](agent-request-proposals.md)で、旅行全体のRequest仮定案について
生成→完了receipt/履歴保存→SSE→明示preview/承認を接続した。本文からJSON/regexで復元しない。
既知条件の置換・解除、人数・目的の変更も明示確認用の案として接続した。item scopeの提案公開は残る。

新規Trip作成前の構造化条件の保持・採用時引継ぎ、候補採用から実項目を含む仮旅程保存も残件。
現在の明示仮保存は空Tripを作成し、その後の条件編集を提供する。

実Cognitoログイン復帰、実アカウントで3件以上の保存/再読込、実モデルの対象維持評価は未実施。
#454/#455/#456は自動closeしない。AWSの変更やmerge/deployは含めない。

## 検証結果

- `npm test`: Frontend/共有Domain 1,550件、Backend/Runtime 895件成功。
- `npm run build`: Frontendの型検査・bundle、Backendの型検査・Lambda bundle成功。
- `npm run architecture:check`（workspace checkを含む）成功。`git diff --check`成功。
- 最終のConversation検索・画面入力保持修正について関連14件を追加実行し成功。
- DOM試験でPC/mobile共通入力・日付Proposal・focus循環・背景scroll復帰・古い入力の拒否を確認。
- 実ブラウザはChromium未配置のため未実施。Playwrightのbrowser取得も接続timeoutで完了しなかった。
- Python/infra試験・paid Live Evalは変更対象に含まれず未実施。Prompt/Tool/model behavior変更なし。
