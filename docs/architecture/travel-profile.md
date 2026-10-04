# Profile V3（Current）

基準: 2026-10-05、main `32d51f6`。UI表示は「普段の出発地／好きなこと／いつも配慮してほしいこと」。

## 目的

Profileは「旅を作るための事前入力」ではなく、毎回説明しなくてよいアカウント共通のsoft hintだけを保存する。
今回の旅行条件、採用済みTrip、予約、現在地、人数、予算、日程、移動上限はProfileへ保存しない。

## 正本

認証済み `/api/profile/v1` → ProfileApplication → owner-scoped Repositoryを唯一の正本とする。
Domain schemaは `UserProfile version: 3`。DynamoDBは `PROFILE_V3` を使い、旧Profileの読込・移行・fallback・dual-writeを行わない。
旧データを削除するmigrationもこの変更では実行しない。

保存項目は次の3項目だけ。すべて任意。

- `usualOrigin`: 普段の出発地。駅・地域などの短い文字列。
- `interests`: 海、自然、温泉、食、歴史などの安定した興味。
- `considerations`: 毎回配慮してほしいこと。自由文で、命令として実行しない。

`version` と `updatedAt` は保存メタデータで、利用者向け設定項目ではない。

## Agentへの渡し方

ApplicationはProfileをそのままpromptへ入れず、bounded projectionを作る。
出発地はoriginのsoft hint、興味はexperienceのsoft hint、配慮事項はuntrustedなexperience hintとして扱う。
現在の会話・Tripに明示された条件が常に優先し、ProfileからTripの人数・日程・予算・移動条件を生成しない。
Profileの変更で既存Tripを更新しない。

## UI

設定画面は3項目だけを表示する。Profile未登録でも相談を開始できる。
編集はaccount-scoped CAS autosaveを使い、IME入力中や保存失敗時に入力を失わない。
Tripの会話からProfileへ自動昇格しない。

## 非互換方針

旧version 2の同行傾向、子ども年代、ペース、移動許容、予算、宿泊/食事別メモ、AI同意fieldはV3へ移行しない。
旧Profileに依存するProfile→Trip条件コピーAPI/Browser操作も撤去する。
TripParty等のDomain型はProfile保存とは独立して維持する。

## 一次根拠と履歴

`modules/trip/domain/travel-profile.ts`、`backend/agent-api/src/adapters/dynamodb-profile-repository.ts`、
`frontend/src/presentation/concierge/travel-profile-panel.ts`と隣接test、Server Context Loader / Effective Intentのtestを参照する。
[ADR 0035](../decisions/0035-store-travel-profile-locally.md)の端末保存は置換済み。
[ADR 0086](../decisions/0086-resolve-profile-as-versioned-reference-only-preferences.md) / [0087](../decisions/0087-autosave-compact-reference-profile-settings.md)はreference-only / 自動保存の判断を維持し、v2のfield保持部分をHistoricalとして読む。
