# KAIHO プロダクト概要

## Currentの範囲

基準: 2026-10-05、main `32d51f68487a1cdc8aa56d9d732738cc90024eb9`（#808 / #810反映済み）。
実装・Terraform・テストを根拠とする。実装済み、固定Providerでの実モデル確認、実Provider・実画面での確認は区別する。
この同期は本番旅行全体の品質合格や#758 / #561の完了を宣言するものではない。

KAIHOは実時刻表から計画上の列車位置を3D地図へ再現し、旅行相談と旅程の編集を提供する。
LLMは要求の理解とTool選択を担い、経路計算・認可・Evidence・候補採用・保存はApplication / Domainが検証する。
互換識別子`transitforge` / `raiquora` / `@raiquora/*`は製品表示名と分けて維持する。

## 利用者と正本

主な利用者は開発者本人。アカウントごとのowner境界を持つ。Cognito Managed Login / PKCEを使い、
Home以外の相談・旅程・設定・運行はログイン後だけ起動する。自己登録は無効で、管理者が利用者を作成する。
Access / ID Tokenは5分、新規ログインの絶対期限とRefresh Token期限は12時間。

Conversation・Profile V3・Trip V2はServer API / DynamoDBが永続正本。
Browserは表示用のメモリ、経路検索設定、ContextWorkspaceの表示状態を持つ。
通信失敗時に旧LocalStorageの会話・プロフィール・旅程へ戻らない。
保存・例外・owner境界は[標準データモデル](architecture/domain-model.md)と[認証境界](architecture/authentication-boundary.md)を参照する。

## 画面の責務

| 画面 | 現在の役割 |
| --- | --- |
| 相談 | HomeのHeroと共通composerから開始。既存旅程の継続相談も同じ相談画面を使う。本文・出典・publicカードを安全なMarkdown / DOMで表示する |
| 旅程 | 専用一覧から旅程を開き、日別タイムラインと日時未定の予定を表示。概算費用は各予定に表示し、鉄道を除いて入力できる。名称・人数・予定時刻・追加・採用・経路選び直しを既存Proposal / CASへ接続する |
| 運行 | 列車・路線・時刻・遅延・混雑と鉄道向け地図操作。大型Landmarkと観光・宿泊・飲食候補のピンを表示しない |
| 設定 | 3項目プロフィールの自動保存、経路検索設定、通知入口、外部サービスの帰属、ログアウト |

相談本文は14pxを基本とし、ライト表示に統一する。スマートフォンの入力は16pxを保持し、見た目を14pxへ縮小してフォーカス時の拡大を避ける。旅程一覧の「削除」はarchive APIの非表示化で、
通常の復元UIはない。予約の取消ではない。準備・確認ポイント・次に決めることの集約パネルは撤去済み。
内部の成立性評価・予約保護・adoption / CASは継続する。画面とモデルの差分は[タイムライン設計](architecture/product-timeline-design.md)を参照する。

## 相談・候補・採用

Strands v2専用Server Agentが`/api/agent-stream`で会話とTripを復元し、Toolを実行する。
Browserにmodel / tool loopや旧Runtimeへのfallbackはない。live・履歴・replayは同じ`AssistantTurnView`へ投影する。

- 日付別時刻表から直通または乗換3回までの経路を検索する。予定と実測・推定遅延を区別する。
- Web・地点・写真・天気・防災・宿泊・飲食・地上アクセスを、取得状態とEvidence付きで扱う。未取得の料金・空室を推測しない。
- 相談の候補と採用済みTripを分離する。明示選択はボタンまたは会話から同じowner・期限・Evidence・予約保護・revision / CAS境界を通す。
- 経路は検証済み時刻表の予定値を保存する。新しい採用では種別・列車名・行先も同じ入力から保存し、旧snapshotの欠損は推測しない。
- 宿泊の採用は最小のホテル名・施設ID・実サービス・宿泊日・出所を保持する。検索時の写真URL・評価・詳細URL・参考価格を観測日時付きで保持し、旅程から宿の詳細・予約ページへ進める。空室・予約状態は保存しない。採用は予約ではない。
- 選び直しは経路全体を再検索し、採用確認時だけ元の移動予定を置き換える。中止時は元の経路を維持する。

単一transportの検索カードと採用案は、公開参照とJourney IDが一意に対応する場合だけ採用操作を統合する。
複合旅行案をタイトルや表示番号だけから保存対象に変換しない。
詳細は[候補選択](architecture/agent-v2-candidate-selection.md)、[workspace](architecture/trip-workspace.md)、[Server Agent](architecture/server-agent-cutover.md)を参照する。

## 普段の好み

Profile V3は任意の「普段の出発地／好きなこと／いつも配慮してほしいこと」だけ。
今回の人数・日程・予算・移動上限はProfileへ保存しない。Profile変更で既存Tripを更新しない。
V3は旧v2の読込・移行・fallback・非表示fieldのround-tripをしない。旧データの一括削除も行わない。
AIへはEffective Intentで解決したsoft / reference-onlyのhintだけを渡す。[プロフィール契約](architecture/travel-profile.md)を参照する。

## データと正しさ

[data-builderのViewer入力](data/viewer-input.md)を使う。列車は`service_uid`、経路は`path_id`、
位置は`route_meter`、時刻は4時境界の業務日付と`route_time_minutes`を正とし、24時超・深夜を扱う。
完全かつ新鮮な当日スナップショットだけを運行表示へ適用する。未取得時の計画位置を実績と扱わない。
現在地座標は端末の最寄り駅選択だけに使い、AWS / モデルへ送らない。外部Providerの秘密値はBackendへ閉じる。

## 対象外と確認の限界

- viewer input / 元GeoJSONの編集・再配布、実績再生、過去運行の復元、運行整理シミュレーション、ダイヤ編集。
- 鉄道運賃・空席・景色の推測、実予約・決済・取消、音声案内。
- 一般公開・自己登録運用、旧Browserデータの自動migration。
- Reservation / Checklistの公開CRUD。共有・in-trip・通知の公開APIは501 gateを維持し、通知入口の存在を配信完成と扱わない。

CIのDomain / SDK fixture / JWT / 合成API / ブラウザ確認は実Provider・実AWS保存のE2Eと別である。
Live実行・既知の未達は[Agent v2テスト戦略](architecture/agent-v2-testing.md)と[製品評価](architecture/trip-v2-product-evaluation.md)を参照する。
