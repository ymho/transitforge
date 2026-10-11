# Conversation / Profile Server保存

`/api/conversations/v1` / `/api/profile/v1` → 専用personal-state Lambda → 共通Cognito verifier →
TrustedPrincipal → Application → owner-scoped DynamoDB server-stateが永続正本。
Browserは認証済みHTTP clientで一覧・履歴・Profileを取得し、表示用メモリだけを保持する。
LocalStorage import / fallback / dual-writeはない。[標準データモデル](domain-model.md)と[認証境界](authentication.md)を参照する。

| Resource | owner内のkey / 保存契約 |
| --- | --- |
| Conversation metadata / message | `CONVERSATION#<UUID>` / `MESSAGE#<conversationId>#<sequence>`。一覧・履歴はcursorで読む |
| Profile V3 | `PROFILE_V3`。`usualOrigin` / `interests` / `considerations`だけ。旧`PROFILE` / v2を読込・移行しない |
| Conversation turn / working state | 同ownerのreceipt・public final・受理条件。完了済み再送ではmodel / Tool / 保存を再実行しない |

更新はexpectedRevisionのCASを使う。Profile削除は本文のない世代fenceを残す。
会話削除はmetadataを直ちに非表示化し、message / turn receiptの削除をcompleteになるまで続行する。
会話のtripIdは独立Tripへの参照で、会話削除はTripを削除しない。archive / detachは会話を消さない。
自動TTLやアカウント退会時の全件purgeの完成を宣言しない。PITR回復時には削除要求の扱いが必要となる。

Server Context Loaderは同ownerのTrip、Profile V3、直近最大12件のtext履歴を読み、取得後のrevisionを再確認する。
ProfileはEffective Intentで解決したreference-only hintから投影し、生Profileを並列の優先順位判断材料にしない。
public finalの構造化表示は[Conversation turn保存](server-state.md)と[表示契約](../specs/agent-publication.md)を参照する。

一次根拠: `backend/agent-api/src/personal-state-api-composition.ts`、`adapters/dynamodb-profile-repository.ts`、
`usecases/agent/server-state-context-loader.ts`と各隣接test、`infra/terraform/environments/dev/server-state.tf` / `agent-stream.tf`。
[Profile V3](../specs/profile.md)の自動保存はIMEとaccount世代を保護し、Tripを暗黙更新しない。

## Turnの冪等性と公開保存

Turnの識別子は認証済みsubject、conversationId、turnId。callerは同一操作の再送で同じIDと入力を保ち、異なる入力のID再利用はconflictにする。Repositoryは既存server-state tableの`TURN#<conversationId>#<turnId>`へrequest hash、state、attempt、lease、結果を保持する。SDKの一時実行IDやHTTP request IDを永続的な操作IDにしない。

begin、complete、failはConversation metadataとturnを既存transaction/CASで更新する。user messageはbegin時に一度だけ保存し、completeはassistant message、public final、receipt、Working Stateを原子的に確定する。本文だけの旧履歴とv2公開snapshotは保存versionで区別し、旧本文から候補・Evidence・保存結果を再構築しない。内部推論、Token、Provider raw、Tool JSONを公開履歴へ保存しない。

startedのattemptとleaseは古いworkerをfenceする。lease切れ後の再開は新attemptのCASを使い、既に完了したturnは同じ保存済みfinalを返す。response消失で保存結果が不明なときは新しいIDで再実行せずreceiptを確認する。部分streamを完了にしない。新turnの受付上限や本文byte上限はRepositoryのvalidatorで検証する。

条件更新はturnのoperation journalへ成功receiptを保存し、同じ条件の再送は二重適用しない。Trip条件への採用は[条件の正本](../specs/trip-conditions.md)のA/B commitを通す。最初の操作が成功し次が失敗した場合、成功済み操作をなかったことにしない。

会話削除のtombstoneはturn writeとreplayを拒否する。message / turn receiptをbounded Queryで削除し、両方のcleanup完了を確認するまで削除完了と扱わない。receiptの無条件TTLは古い再送の安全性を失わせるため設けない。PITR・アカウント全体のpurgeは独立した運用判断である。

一次根拠: `backend/agent-api/src/usecases/agent/conversation-turn.ts`、`adapters/dynamodb-conversation-turn-repository.ts`、`frontend/src/domain/assistant-turn-view.ts`と隣接テスト。保存された値と公開可能な値の区別は[公開表示契約](../specs/agent-publication.md)を参照する。
