# 標準データモデル

この文書はTransitForgeが扱う主要なデータモデルの案内である。

型とスキーマの実装を正本とし この文書は責務 保存先 生成元 結合キーを説明する。型を変更するときは
対応する実装 テスト この文書を同時に見直す。ER図が必要な範囲だけ 将来`domain-model.dbml`を補助資料として追加する。

## 境界

| 区分 | 役割 | 正本 |
| --- | --- | --- |
| 時刻表入力 | 列車 停車時刻 経路 駅 路線の計画データ | data-builder生成の`viewer-input` |
| リアルタイム入力 | 混雑 遅延 行き先変更 停車状態 | data-builder収集の交通スナップショット |
| 検索ドメイン | 入力をもとにした経路候補と制約 | `src/domain/` |
| 旅行相談 | 普段の好みと今回の条件 会話の状態 | `src/domain/`とブラウザLocalStorage |
| AI応答 | UIへ返す経路 旅行 会話の構造化結果 | `src/domain/viewer-agent-response.ts` |
| フィードバック | 利用者が明示送信した会話と評価 | private S3 |

ブラウザの画面状態やMapbox Three.jsの描画オブジェクトはドメインモデルではない。AWS認証情報
外部提供者の秘密値 現在地座標もこのモデルへ含めない。

## 時刻表と運行

### `TrainIndex` `Train` `TrainStop`

- 定義: `src/data/train-index.ts`
- 保存先: `viewer-input/train_index.json`
- 生成元: transitforge-data-builder
- 用途: 列車表示 経路検索 駅と路線のカタログ

`Train`は営業日内の列車を表す。識別子は`service_uid`であり `train_no`は遅延 混雑との結合と
表示に使う。停車時刻は`TrainStop`で保持し 時刻計算には`route_time_minutes`を使う。

### `PathCatalog`

- 契約: `docs/data/viewer-input.md`
- 保存先: `viewer-input/path_catalog.json`
- 結合キー: `Train.path_id` → `PathCatalog.paths[].path_id`

経路は列車と分離して座標列として保持する。同じ線路を走る列車は同じ`path_id`を参照できる。

### `TrainDelaySnapshot` `TrainOperation`

- 定義: `src/data/train-delay.ts`
- 保存先: `/api/traffic/delays.json`
- 結合キー: `Train.train_no` → `operationsByTrainNumber`

`TrainOperation.destination`は当日の行き先の正本である。スナップショットが完全かつ新鮮なときだけ
デジタルツイン表示へ適用する。スナップショットに存在しない列車は運休として扱う。

### `TrainCongestionSnapshot`

- 定義: `src/data/train-congestion.ts`
- 保存先: `/api/traffic/congestion.json`
- 結合キー: 列車番号

車両ごとの混雑値はブラウザで列車単位に集約して描画する。混雑はリアルタイムの補助情報であり
時刻表や経路検索の正本ではない。

詳細なJSONスキーマと時刻の表現は[ビューワー入力仕様](../data/viewer-input.md)を参照する。

## 経路検索

### `JourneyRouteLeg` `JourneyRouteResult`

- 定義: `src/domain/direct-route-search.ts`
- 生成元: 日付別接続インデックスを使う経路検索

`JourneyRouteLeg`は1列車で移動する区間 `JourneyRouteResult`は複数区間を含む候補である。
区間には予定時刻と 適用可能な場合だけ実測または推定の遅延を含める。乗換は独立した列車ではなく
隣り合う区間の駅と時刻差から表現する。

### `DirectRouteSearchResponse`

- 定義: `src/domain/direct-route-search.ts`
- 境界: ブラウザからAI Lambdaへの経路検索結果

検索条件と候補を1つにまとめる応答である。日付 `departureDate`と業務日付 `serviceDate`は別の値として
保持する。除外 必須 種別限定の条件は検索後の表示処理ではなく検索契約として保持する。

### `JourneySearchPreferences`

- 定義: `src/domain/journey-search-preferences.ts`
- 保存先: ブラウザLocalStorage

乗換ペース 経路優先 最大乗換回数を表す。これは検索時の好みであり 旅行プロフィールには含めない。

## 旅行相談

### `UserProfile`

- 定義: `src/domain/travel-profile.ts`
- 保存先: LocalStorage `transitforge.travel-profile.v2`
- 更新元: 初回オンボーディングとプロフィール編集

普段の出発地 同行者 好み 旅行ペース 許容移動時間を表す。個人を直接特定する情報や子どもの
生年月日は保存しない。コンシェルジュの選定と将来の旅行推薦に使う。

### `TripContext`

- 定義: `src/domain/travel-profile.ts`
- 保持範囲: 現在の旅行相談

今回の行き先 希望日 興味 同行者 移動条件などを表す。一回限りの「海に行きたい」はここへ入り
普段の「山が好き」は`UserProfile`へ入る。両者を混在させない。

### `ConversationGuidance` `ConversationSubmission`

- 定義: `src/domain/conversation-guidance.ts`
- 生成元: Bedrockの`ask_follow_up`ツール

`ConversationGuidance`は次の質問 質問の種類 クイックリプライ `TripContext`を持つ。
UIはこの契約を共通入力として描画するだけで 会話パターンごとの日付入力や宿泊数入力を持たない。
`ConversationSubmission`は利用者の回答と直前のガイダンスを結び 次のAI呼び出しへ渡す。

### `ConversationHistoryEntry`

- 定義: `src/domain/conversation-history.ts`
- 保存先: LocalStorage `transitforge.concierge-history.v1`

コンシェルジュ画面に表示した利用者の発話と構造化されたAI応答を最大50件保存する。再読み込み後も
表示を復元するための端末内履歴であり Bedrockへ全履歴を送信する用途には使わない。

## AIと旅行候補の応答

### `ViewerAgentJourneyPlan`

- 定義: `src/domain/viewer-agent-response.ts`
- 内容: 検索条件と`JourneyRouteResult[]`

AI応答からUIへ渡す経路表示用モデルである。`JourneyRouteResult`をそのまま再解釈せず タブと
タイムラインへ描画する。

### `ViewerAgentTravelPlan`

- 定義: `src/domain/viewer-agent-response.ts`
- 内容: 行きの経路 帰りの経路 宿泊候補

旅行の鉄道運賃は含めない。宿泊候補の空室と日付別料金は正本データがない限り保持も表示もしない。

### `ViewerAgentResponse`

- 定義: `src/domain/viewer-agent-response.ts`

AIからUIへ返す合併型である。文字列 経路 `ViewerAgentJourneyPlan` 旅行 `ViewerAgentTravelPlan`
追加質問 `ConversationGuidance`のいずれかを返す。AIの自由文をUIの状態遷移に使わない。

## 明示的なフィードバック

### `conversation-feedback-v1`

- 定義: `infra/lambda/bedrock_agent/conversation_feedback.py`
- 保存先: private S3 `conversation-feedback/YYYY/MM/DD/<feedbackId>.json`
- 内容: 評価 `rating` 会話 `conversation` APIリクエストID `requestIds`

利用者が👍または👎を押したときだけ保存する。会話分析やIssue化は別の処理として扱い 本モデルは
画面表示とAIプロンプトへ自動再投入しない。

## 変更時の確認

1. 型またはスキーマの正本を変更する
2. 境界をまたぐ変換とバリデーションを更新する
3. 該当するTypeScriptまたはPythonテストを追加する
4. この文書と`docs/data/viewer-input.md`の記述を見直す
