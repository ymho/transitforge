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

### 駅名と業務時刻の値表現

- 駅名比較の正本: `src/domain/station-name.ts`
- 経路時刻表示の正本: `src/domain/route-time-format.ts`

入力に含まれる駅名表記は保持し 比較と索引を作るときだけNFKC 空白 末尾の`駅`と
`ヶ` `ケ`の表記揺れを正規化する。画面用の駅名を比較用の値で上書きしない。

`route_time_minutes`は4時を境界にした業務日付内の値であり 24時以降を許容する。
時刻表は`24:20`のように業務時刻を維持し 経路カードや会話上の時計時刻は`00:20`のように
翌日の時計へ折り返す。呼び出し元で剰余計算を再実装せず 用途に合う共通関数を選ぶ。

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

### `JourneySearchService` `search_journeys`

- ドメイン契約: `src/domain/journey-search-service.ts`
- Agent Adapter: `src/domain/agent/search-journeys-tool.ts`
- 現在の実装: `/api/agent`の`journey_search`を呼ぶHTTP client

`JourneySearchService`はCSAや直通インデックスの実行場所を利用側から隠し 日付 乗換上限
乗換ペース 順位条件 列車の除外と必須条件を構造化して渡す。`search_journeys`はこのServiceを
呼ぶ薄いAdapterであり 経路や順位をLLMで再計算しない。

Agentへ返す候補は最大3件 直列化後64KiBまでに制限する。予定時刻 遅延適用後の時刻
遅延の観測または推定区分 制約結果はService応答を変更せず保持する。

### `NetworkInspectionService`

- ドメイン実装: `src/domain/network-inspection-service.ts`
- Agent Adapter: `src/domain/agent/network-inspection-tools.ts`
- 入力: `TrainIndex`と`StationLineCatalog`

列車 駅 1列車内の経路詳細を読み取り専用で照会する。`inspect_train`はserviceUidが完全一致する
列車の概要だけを返し 全停車駅は含めない。`inspect_station`は共通駅名正規化による完全一致だけを
採用し 前方一致候補が複数ある入力を曖昧な駅として拒否する。LLMや外部APIによる駅名補正は行わない。

`get_route_details`はserviceUidと任意の発着駅で検証した区間を返す。停車記録は1回20件まで
ページングし 3つのToolはいずれも直列化後48KiBを上限とする。応答には取得できる場合だけ
業務日付 代表ダイヤ区分 カタログの生成元を含める。

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
旅行検索で出発駅が明示されていないときは`home.station`を普段の出発駅として使う。

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
- 保存先: LocalStorage `transitforge.concierge-history.v2`

コンシェルジュ画面に表示した利用者の発話と構造化されたAI応答を会話セッションごとに最大50件保存する。
再読み込み後も表示を復元し 同じセッションの直近3件だけを短いテキストへ変換してBedrockの文脈に使う。
別の相談の全履歴を無条件に混ぜない。
AI応答には取得できた`x-transitforge-request-id`も保存し 再読み込み後の明示的なフィードバックへ紐付ける。

### `ConversationSession` `TravelMemory`

- 定義: `src/domain/conversation-session.ts`
- 保存先: LocalStorage `transitforge.conversation-sessions.v2` `transitforge.travel-memories.v1`

`ConversationSession`はUUIDで相談を識別し 現在の対象を`general` `trip` `place` `route`のスコープで表す。
短い要約 確認済みの話題 未確認の話題と 関連する`TripPlan.id`を持つ。直近20セッションを端末内に保持する。

`TravelMemory`は会話から得た継続的な好みである。一回限りの`TripContext`と分離し 高確度の記憶だけを
別セッションのAI文脈へ渡す。現在の明示的な依頼と`UserProfile`を上書きしない。

### `TripPlan` `TripPlanItem` `TripPlanPatch`

- 定義: `src/domain/trip-plan.ts`
- 保存先: LocalStorage `transitforge.trip-plans.v2`

1つの`ConversationSession.id`に対して編集対象の`TripPlan`は1つだけ保持する。別の旅行は新しい会話
セッションとして分離する。同じ旅行の変更案やタイトル再生成は旅程を増やさず 現在の旅程への
`TripPlanPatch`として扱う。旧キー`transitforge.trip-plan.v1`の単一旅程は現在の会話へ一度だけ移行する。

編集可能な旅程は`movement` `stay` `sightseeing`の3種類だけで構成する。`movement`は鉄道経路のほか
レンタカー 車 バス 徒歩を表現できる。鉄道区間は検索済みの`ViewerAgentJourneyPlan`を保持し
検索結果のない所要時間や予約情報を補完しない。

`TripPlanConditions`は今回の旅行だけに適用する大人人数 子どもの人数 最大8件の考慮事項を持つ。
普段の同行者や好みを表す`UserProfile`とは分離し 旅程のメタデータ変更として確認後に保存する。

画面では各項目を独立したカードとして表示する。鉄道移動は保持している経路から発着時刻 列車
行き先 路線 乗換待ち時間 遅延を描画し 自由文から経路情報を補完しない。
カードの開閉状態とカード間の追加導線は画面状態であり`TripPlan`へ保存しない。追加導線は前後の
`TripPlanItem`を自然文の相談へ変換し AIが提案した`TripPlanPatch`だけを確認後に反映する。

既存旅程の変更は`TripPlanPatch`の追加 置換 削除 並べ替え メタデータ変更として提案する。
AI応答だけでは保存せず 利用者が画面で反映を選んだ後に適用する。日程と鉄道経路の変更は
自由文から組み立てず 宿泊検索と経路検索の構造化結果からパッチを生成する。
タイトル再生成は現在の移動 滞在 観光をAIへ渡し 行程を変えず`metadata.title`だけを提案する。

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
追加質問 `ConversationGuidance` 旅程変更 `TripPlanUpdateProposal`のいずれかを返す。
AIの自由文をUIの状態遷移に使わない。

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
