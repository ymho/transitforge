# Trip revision / mutation（#389）

#402の[ready gate](trip-feasibility.md)はprepare内で実際の変更後Tripを評価する。
古い評価の自己申告は受け付けず、最後の同じCAS/receiptを維持する。

#398でprepareを非同期検証にも対応させ、[予約済み項目の変更保護](trip-reservation.md)を追加した。
既存Trip CAS/receiptは維持し、Reservationは独立revisionで更新する。

親方針は #382/#415、保存基盤は #388、UI は #390。同じ Trip / Proposal / Repository / converter を拡張する。
判断は [ADR 0054](../decisions/0054-commit-trip-mutations-atomically.md)。**公開 writer は引き続き OFF**。

## Before / After

| 境界 | #388 まで | #389 |
| --- | --- | --- |
| Domain | schemaVersion 2 / revision は既存、Proposal に revision なし | 同じ Proposal の必須 baseRevision と一致検証 |
| Preview | pure atomic Patch | 同じ意味論、revision/updatedAt は不変 |
| Repository | 非 CAS replace、入力 revision をそのまま保存 | replace 廃止、applyMutation と DynamoDB の atomic CAS |
| 保存成功 | 更新番号の増加なし | baseRevision + 1、注入した server Clock の updatedAt、createdAt 不変 |
| retry | create の既存拒否、lost response は GET 回復 | create は同じ UUID/全内容で冪等。mutation は owner 内 ID と receipt で重複排除 |
| UI | read/preview、DEV の memory confirm のみ | reviewed authenticated host 向け確認 seam。公開組成は read-only のまま |
| migration | memory の pending、attempt / success marker | pending を Session metadata に先行保存、Web Locks で account/session ごとに排他 |

## Domain / Application

`Trip.schemaVersion: 2` は構造、`Trip.revision` は同じ旅行の編集世代。legacy TripPlan.version と
LocalStorage store.version はどちらも編集 revision ではない。既存 converter の初期 revision 0 は変更しない。

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
旧 `operation: "replace"` は拒否する。未公開基盤のため公開済み client の段階移行は不要。
ownerId/userId、未来の updatedAt、自由な resulting revision、確認 authority 等の追加 field は拒否する。
返却値は `version / trip / revision / mutationId`。HTTP client も一致検証する。

所有者は従来どおり trusted server principal。キーは `OWNER#subject / TRIP#uuid`、他 owner/不存在/archived は 404。
active な対象で古い revision は 409 `conflict`、同じ mutation ID の異内容は 409 `mutation-reused`。
overflow/non-safe integer/不正 Proposal は 400、上限超過 413、通信や不明失敗は unavailable。ログへ本文を出さない。

既存 storageVersion 1 envelope に数値 `revision` を追加する。Trip の JSON 内 revision と一致検証する。
旧 #388 envelope は read 互換を維持し、revision 属性がない場合のみ exact old Trip JSON を条件に使う。
その最初の成功更新で属性を追加する。番号を 0 に戻す一括 migration、別 writer、dual-write はしない。

`TransactWriteItems` は以下の 2 record を原子的に書く。

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

transaction は Put/Update の既存 IAM 権限を利用する。新 IAM action/ARN、Terraform 変更、公開 route はない。
根拠: [AWS の transaction IAM 契約](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)。

## Workspace / retry

直接操作も候補採用も同じ baseRevision を付ける。`confirmCandidateSelection` は再解決より先に
shown Proposal と current revision を確認し、従来の期限/時刻表再検証も維持する。
controller は preview の元 Trip と確認時の current を照合し、違えば破棄して再確認を要求する。

`ServerTripWriter` は認証・候補再検証を配線する reviewed host のみが注入する。
public composition の `createReferencedTripSource` は writer を渡さない。CAS ができたことを認証の代わりにしない。
確認 host は最新 GET → Domain preview → 候補等の確認 → mutation ID 発行 → CAS → 最新 GET と進む。
race は最後の CAS でも拒否する。競合時は旧 Proposal を破棄し、最新 Trip を表示して確認し直す。
silent rebase、自動再提案、AI semantic merge はしない。

通信失敗で結果が不明な時はメモリ内の同一 request/ID を保持し、再読み込みボタンで同じ mutation を retry する。
その間 current は unavailable とし、legacy writer を再開しない。receipt 成功後も最新 GET が失敗すれば
「最新の旅程を再取得できない」と表示し、成功を current 取得成功と混同しない。
通常 mutation の reload は pending Patch を自動再送せず最新 GET から再確認する。offline queue/merge は実装しない。
memory-only DEV と server 保存 host のボタン/結果表示を区別する。

## Import / reload / links

`migrateTripWorkspace` はネットワークより先に同じ Session の `tripSourceState: migration-pending` を保存する。
失敗時は upload しない。reload/別タブでも source を復元し、Trip 未取得でも legacy gate を閉じる。
遅れて届いた chat metadata 保存で pending/server-v2 を legacy に戻さない。認証なしの自動再開はしない。

既存の同じ `migrateTripToServer` を account/session scoped Web Locks で囲む。
全タブは lock 取得後に attempt/marker を読み、同じ安定 UUID と原本を使う。Web Locks 未対応では import を拒否する。
create は安定 UUID が import の冪等キー。既存と全内容が等しければ成功を返し、違えば決して上書きしない。
応答消失後の GET/read-back/全内容比較/success marker/原本保持は従来どおり。
旧 converter や schema は再実装しない。複数端末/旧版 client の書込みを解決する offline merge は対象外。

会話 attach/detach は同じ値の Put/Delete として再送可能。Trip revision を増やさず link revision も新設しない。
認証失効/アカウント切替と source 破棄を含む public rollout は、認証 Provider 導入時に別途レビューする。

## AC / 検証対応

| 要件 | テスト |
| --- | --- |
| 全 Patch の baseRevision、preview 不変、invalid 原子性 | `trip-revision.test.ts`、既存 Domain Patch/state/request tests |
| 5+A→6/retry→6/B conflict/A異内容拒否/6+C→7 | `trip-mutation.test.ts` |
| read-write race、同時 retry、lost response、old envelope | 同上、SDK transaction contract fake |
| owner/archived/overflow/createdAt/server Clock/HTTP privacy | 同上、`dynamodb-trip-repository.test.ts`、handler test |
| candidate stale revision/再検証、UI direct edits | `select-trip-candidate.test.ts`、controller/Workspace tests |
| conflict→GET/旧案破棄、retry、latest/unavailable、public read-only | `server-trip-workspace-source.test.ts`、HTTP client test |
| pending reload/別タブ/原本/内容相違/失敗 | `trip-migration-storage.test.ts`、migration Workspace/source tests |
| 公開 writer 認証 gate/IAM | `tests/infra/test_trip_storage.py` |

必須確認: npm test / build / architecture:check / workspace:check / eval:agent:smoke / eval:agent:full、
infra security tests、git diff --check。実施結果は PR に記載する。
AWS Live DynamoDB CRUD/Live Eval/deploy は実施していない。SDK fake は実サービス試験ではない。
Agent Runtime/Prompt/Tool 選択を変更しないため Live 再実行は不要。従来の AWS 認証期限切れの未実施記録を維持する。

後続 #399: 共有権限・presence。#402: 成立性/ready 評価。認証 rollout、予約、通知、offline merge は今回対象外。
