# Trip Server保存

Trip V2は認証済みPOST `/api/trips/v1` → 専用Trip API Lambda → TripApplication → owner-scoped Repositoryが永続正本。
GatewayとBackendがCognito Access Token / `raiquora/user`を検証し、ownerはTrustedPrincipalから決める。
BrowserにTrip本文・revisionのLocalStorage保存、legacy migration、dual-write、取得失敗時fallbackはない。

`Trip.schemaVersion`（2または3）、wire `trip-api-v1`、DB `storageVersion`、編集revisionは別概念。
`OWNER#<subject>` / `TRIP#<uuid>`内でcreate / get / cursor list / mutation / archiveを処理し、全table Scanを行わない。
変更はbaseRevision / mutationId / Proposalを用い、Trip更新・receipt・outboxを原子的に保存する。
応答消失後の同一mutation再送は同じreceiptを使い、競合時は再取得・再提案・再確認へ戻す。
[更新契約](trip-persistence.md)と[候補選択](agent-publication.md)を参照する。

Conversation metadataのtripIdは独立Tripへの参照。会話削除・参照解除でTripを削除しない。
Browserは一覧cursorを収集してから表示し、途中失敗を空一覧へ変換しない。
HomeはHeroと公式しおりを表示し、保存済みTripは専用の旅程一覧から開く。
一覧の「削除」はarchiveによる非表示化で本文を保持し、通常の復元UI・永久削除APIはない。予約取消ではない。

一次根拠: `backend/agent-api/src/trip-api-composition.ts` / `trip-handler.ts`、
`usecases/trip-application.ts` / `adapters/dynamodb-trip-repository.ts`と隣接test、
`frontend/src/adapters/http/server-trip-client.ts` / `usecases/trip-plan/server-trip-workspace-source.ts`、
`infra/terraform/environments/dev/trips.tf` / `agent-stream.tf`。
画面とDEV previewは[Trip workspace](trip-workspace.md)、共有・未公開の通知・予約等は[認証台帳](../architecture/authentication.md)を参照する。

## Trip revision / mutation

## Domain / Application

`Trip.schemaVersion` は構造、`Trip.revision` は同じ旅行の編集世代。wire version、DB storageVersion、編集revisionを混同しない。

`TripUpdateProposal.baseRevision` は作成時に読んだ Trip の revision。item 採用/直接編集、Request/Party、
仮定の確認/却下、planning/lifecycle の Application builder が current Trip から設定する。
モデルの Tool input に番号を追加しない。既存 Tool は同じ builder を呼び、合成 preview も元の番号を維持する。
古い Tool 応答は Domain で拒否する。固定 router、質問順、AI merge は追加しない。

`applyTripProposal` は ID/revision 一致 → Patch 全体 → aggregate invariant の順で検証する。
不一致は `TripRevisionConflict`、不正入力は validation error。add/replace/remove/move/request/planning/lifecycle の
既存原子的意味論、Evidence/保存許諾/scheduled rail/PlanAssumption は維持する。
純粋 preview は revision/updatedAt を増やさない。

Backend `TripApplication` は既存 Domain apply を prepare callback として唯一の Repository に渡す。
Repository は current の取得・receipt 回復・CAS/時刻付与を担当し、callback が失敗した場合は一切書かない。
`confirmedLifecycle` は trusted Application host の別引数。HTTP body/モデルからは受け取らず、
現在の HTTP handler はこれを付与しない。schedule basis は注入 server Clock と既存 Domain で検証する。
Snapshot を JSON 検証したことだけで採用元 Evidence の真実性を証明したことにはしない。
候補再解決/保持許諾/利用者確認は既存採用境界および認証済み確認 host の必須責務のまま。

## Wire / owner / persistence

既存 POST `/api/trips/v1` / `version: "trip-api-v1"` に `operation: "mutate"` を定義する。
必須 field は `tripId / baseRevision / mutationId(UUID) / proposal`。Proposal 内 ID/番号も envelope と一致必須。
旧 `operation: "replace"` は拒否する。既存 client は `mutate` 契約を使うため、別の段階移行は不要。
ownerId/userId、未来の updatedAt、自由な resulting revision、確認 authority 等の追加 field は拒否する。
返却値は `version / trip / revision / mutationId`。HTTP client も一致検証する。

所有者は従来どおり trusted server principal。キーは `OWNER#subject / TRIP#uuid`、他 owner/不存在/archived は 404。
active な対象で古い revision は 409 `conflict`、同じ mutation ID の異内容は 409 `mutation-reused`。
overflow/non-safe integer/不正 Proposal は 400、上限超過 413、通信や不明失敗は unavailable。ログへ本文を出さない。

既存 storageVersion 1 envelope に数値 `revision` を追加する。Trip の JSON 内 revision と一致検証する。
旧 #388 envelope は read 互換を維持し、revision 属性がない場合のみ exact old Trip JSON を条件に使う。
その最初の成功更新で属性を追加する。番号を 0 に戻す一括 migration、別 writer、dual-write はしない。

`TransactWriteItems`はTripとreceipt、および[TripChanged outbox](trip-monitoring.md)のsignalを原子的に書く。

1. Trip: active かつ既存 revision == baseRevision（旧 envelope は前述の exact JSON）を条件に更新。
2. receipt: 同 owner の `MUTATION#mutationId` が未存在の時だけ作成。

receipt は canonical JSON から SHA-256 で得た `tripId/baseRevision/proposal` digest と成功した Trip を保持する。
object key 順は同一視し、配列順・summary・Patch 内容は区別する。mutation ID は Application/UI が生成する。
同じ owner で同じ ID を異なる Trip/内容に使えば拒否する。他 owner の receipt を読む操作はない。
同一 retry は後続編集の後でも**当初の成功結果**を返す。current は別途 GET する。
transaction の条件失敗/応答消失でも receipt を再取得し、成功済みなら二重 apply しない。
receipt なしの条件失敗は conflict。保存失敗/容量不足等は成功にしない。

各 Trip と各 receipt の Trip 本文は 256 KiB 以下（既存 boundedTrip）、receipt は固定長 digest/キーのみを追加する。
Trip record に履歴配列を積まず、Query も TRIP prefix だけなので receipt は一覧に出ない。
receipt に TTL は設けない。ID 再利用拒否/元結果返却を保つためで、record 総数と保存費用は更新回数に比例する。
将来の削除/保持期間は receipt と ID tombstone を含む privacy 設計が必要。無条件 TTL による安全保証の失効はしない。

transactionは専用roleの最小権限を使い、Agent経由の書込みはTransactWriteItemsに限定する。
根拠: [AWS の transaction IAM 契約](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)。

## Workspace / retry

直接操作も候補採用も同じ baseRevision を付ける。`confirmCandidateSelection` は再解決より先に
shown Proposal と current revision を確認し、従来の期限/時刻表再検証も維持する。
controller は preview の元 Trip と確認時の current を照合し、違えば破棄して再確認を要求する。

`ServerTripWriter` は認証・候補再検証を配線する reviewed host のみが注入する。
本番compositionは認証済みServer writerへ接続する。CASができたことを認証の代わりにしない。
確認 host は最新 GET → Domain preview → 候補等の確認 → mutation ID 発行 → CAS → 最新 GET と進む。
race は最後の CAS でも拒否する。競合時は旧 Proposal を破棄し、最新 Trip を表示して確認し直す。
silent rebase、自動再提案、AI semantic merge はしない。

通信失敗で結果が不明な時はメモリ内の同一 request/ID を保持し、再読み込みボタンで同じ mutation を retry する。
その間 current は unavailable とし、legacy writer を再開しない。receipt 成功後も最新 GET が失敗すれば
「最新の旅程を再取得できない」と表示し、成功を current 取得成功と混同しない。
通常 mutation の reload は pending Patch を自動再送せず最新 GET から再確認する。offline queue/merge は実装しない。
memory-only DEV と server 保存 host のボタン/結果表示を区別する。
