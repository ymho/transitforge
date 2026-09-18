# Trip server resource foundation（#388）

#451第一段階で[共通trusted principal / Cognito verifier](authentication-boundary.md)を追加した。
検証済みissuer + subを既存`TripPrincipal.subject`へ写す。以下のProvider未導入記述は導入時の記録である。
公開HTTPへの認証接続・Cognitoリソース・本番writerは引き続き未有効。

#389 で replace を CAS mutation に置換し、receipt / revision / import 排他 / reload gate を統合した。
最新契約は [Trip concurrency](trip-concurrency.md)。以下の非 CAS/read-only 制約は #388 時点の導入記録であり、
公開認証と本番 writer が未有効という gate は #389 後も維持する。

親方針は #382/#415、正本は同じ `modules/trip/domain/trip.ts`。#388 は Repository/Application と
明示 migration の基盤を実装する。**認証 Provider は未導入で、公開 CRUD と本番 writer は有効にしていない。**
判断は [ADR 0053](../decisions/0053-gate-owner-scoped-trip-persistence.md)。#389 が CAS/冪等性を担当する。

## Before / After

| 境界 | Before | #388 |
| --- | --- | --- |
| 正本 | legacy の session ID ごとの TripPlan | 同じ Trip V2 を独立 UUID で保存できる内部基盤。通常利用の writer はまだ legacy |
| identity | Agent event に principal なし | `TripPrincipal.subject` を全 Repository 操作へ必須注入。公開認証 Adapter は未導入 |
| 保存 | LocalStorage のみ | 専用 DynamoDB table と storageVersion 1 envelope。Trip の schemaVersion 2 / revision を保持 |
| 会話 | 削除時に legacy 旅程も削除 | `tripId?` の参照だけ。削除/eviction/detach は Trip と旧原本を削除しない |
| Workspace gate | currentTrip がある時のみ legacy を停止 | source 所有権で停止。loading/error でも停止を維持 |
| migration | 明示 server import なし | 同じ converter → create → GET 確認 → success marker → reference。公開 UI は gate 下 |

## Principal / Repository / API

- 唯一の `TripRepository` port は Backend `src/ports/trip-repository.ts`。
  `create/get/list/replace/archive` は全て `TripPrincipal` 必須。内部 worker も同じ境界で owner を解決する。
- `subject` は server の信頼された認証処理が確立する。不明なら拒否。HTTP body/header の
  `ownerId/userId` や固定 owner を認証に使わない。CloudFront OAC / Lambda URL IAM は origin 保護であり利用者認証ではない。
- `createInternalTripApplication(table)` は IAM/internal 組成用。現在の `lambda.ts` には組み込まない。
- 独立 handler の契約は POST `/api/trips/v1`、envelope `version: "trip-api-v1"` と `operation`。
  `create/replace` は `trip`、`get/archive` は `tripId`、`list` は optional `limit/afterTripId`、
  `attach` は `conversationId/tripId`、`detach/reference` は `conversationId`。他 field/version は拒否する。
  Browser に owner を指定する引数はない。将来の認証 session は transport が送る。
- **CloudFront/API Gateway に Trip route を追加していない。** Lambda が直接 `/api/trips/*` を受けても、
  application/verifier を持たない handler が 501 を返す。verifier が未認証を返す内部試験は 401。
  owner B が owner A の ID を渡しても存在しない ID と同じ 404。入力 400、上限 413、既存 create 409、利用不可 501。
- 公開時には認証 Adapter・認証失効/アカウント切替時の source 破棄と #389 の書込統合をレビューする。
  JSON の型検証だけでユーザー/モデル由来の Evidence を信頼するものではない。
  現在の internal create/replace の呼出し側も、既存の候補採用・Evidence/保持許諾・Domain validation 境界を通す。

### Storage

`PK=OWNER#<subject>` / `SK=TRIP#<uuid>`（実属性名 `pk/sk`）。Trip は検証済み JSON string として格納し、
`storageVersion=1` / `archived:boolean` を envelope に持つ。別の ServerTrip Domain は作らない。
全アクセスは owner key 内。Query は `begins_with(sk, TRIP#)`、最大 50 records、既定 20。
`afterTripId` は現在 owner の key に再構成し、DB の PK や別 owner の cursor は返さない。
archive record だけの page は空配列＋次 cursor になり得る。全 table Scan はない。

create の既存拒否、replace の existing/active 条件、createdAt 不変を検証する。
**replace は非 CAS。revision を保持するだけで lost update を排除しない。** revision 増加、
expected/baseRevision、mutationId、idempotency ledger は追加していない。#389 完了まで通常 UI の保存 host は作らない。

archive は保管上の非表示で、Trip.lifecycleState や予定を変更しない。本文は保持し、get/list/replace の対象から外す。
永久削除/復活 API はない。将来の削除・Reservation・Watch の扱いは各担当でレビューする。

### Bounds / privacy

API/Repository は同じ `boundedTrip` を使い、Domain の exact-key validation を再利用する。
body は UTF-8 256 KiB、items/constraints/assumptions は各 100、全 string は最大 4,096 UTF-16 code units、
配列最大 1,000、深さ 32。Domain の狭い field 制約は引き続き適用する。API の運用上限であり Domain 数量モデルを再定義しない。
切り捨てず 400/413。DynamoDB 400 KiB に対して key/envelope の余裕を確保する。
Snapshot 内の raw Provider response / query/token URL は既存 validation で拒否し、未知 field を保存しない。

handler log は `requestId/category` だけ。SDK/Domain の message、Trip/Party/Place/Request、認証主体は出力しない。
HTTP は `Cache-Control: no-store`。Browser は取得 Trip をメモリ read view として持ち、LocalStorage に server Trip を書かない。

## Conversation reference

local `ConversationSession.tripId?` は UUID 参照。`tripSourceState?: "server-v2"` は Application/UI の source 所有権で、
Trip の planning/lifecycle ではない。detach 後にも source 所有権を維持し、旧旅程の自動復活を防ぐ。
Trip は会話 ID/本文を持たない。複数会話が同じ Trip を参照できる。

server 側は同じ owner partition の `CONVERSATION#<id>` に link だけ保存する。これは会話本文の server 保存ではない。
attach は owner 内の active Trip の存在を確認する。会話 ID は owner 内の不透明な参照名で、他 owner の本文/参照を返さない。
detach は link のみ削除。archive した Trip の link は残り、`reference` で ID を取得した後の `get` は not-found。
archive と attach 間の競合でも dangling link として同じ扱いになる。#389 前に跨 record の原子性は約束しない。
会話削除はローカル履歴だけ。server link が残っても Trip 所有権を与えず、会話を復活させない。
履歴本文は archive/detach で消さない。参照先不明・認証不可は Workspace unavailable とし、履歴は表示できる。

## Migration

実装入口は `migrateTripToServer`、Workspace 接続は `migrateTripWorkspace`。
**現時点では認証/同意付き公開 import ボタンを設置しない。** injected authenticated transport による内部試験で検証する。

1. 認証 account scope がなければ upload/marker/UUID 生成をしない。scope はローカル metadata の名前空間であって server 認可値ではない。
2. `BrowserTripMigrationStore` が session の legacy record を独立 parse。不正な別 record を理由に全件破棄しない。
   既存 converter を使い、必要な構造化 legacy context は `LegacyMigrationInput.options` で供給できる。
   Browser の既定 reader は TripPlan 原文だけを読み、会話全文/Profile の自動 upload・推論はしない。
3. 成功 marker と区別した recovery attempt を保存する。固定 Trip UUID、V2 resource の作成日時、元 JSON を
   account/session scope で保持する。これは復旧 metadata であり保存済み Trip ではない。
4. 同じ `convertLegacyTripPlan` で変換。warnings/deferred/requiresLegacyRetention をそのまま返す。
   選択/観測/取得日時・許諾の捏造はせず、候補 options を選択 snapshot にしない。
5. target UUID を owner-scoped GET。未作成なら create、続けて GET で Domain validity/全内容一致を確認。
   応答消失後は固定 UUID の GET から再開し、違う内容の server Trip を replace しない。
6. 旧原文の不変を再確認して success marker。続けて server link/local session ref を更新する。
   marker だけあり server が不明なら server-v2 unavailable。新規 upload/legacy writer へ戻さない。
7. marker/attach/local quota 失敗は未完了表示。原本は保持し、固定 attempt / success marker から retry する。
   `migration-pending` の間は legacy 編集を凍結する。成功後の local ref 更新失敗も同じ Workspace gate を維持する。

success marker は `tripId/verified` だけ。server 正本ではない。旧 raw/attempt は成功後も削除しない。
会話削除/eviction も旧 TripPlan の cascade をしない。旧単一キー reader も原本を保持し、store が既にあれば
別会話へ繰り返し自動コピーしない。store がある場合の未対応単一原本は自動 attach せず明示 recovery 対象とする。

本実装は #389 の idempotency/並行 migration 保証ではない。複数 tab の attempt 競合・認証切替・
旧版 client の後続書込み・複数端末の重複取込を含む本番 rollout は未有効。安易な再送 create/replace や offline merge はしない。
原本削除と完全な legacy Storage helper の撤去/Port 注入は別の互換整理。今回 helper の既存呼出し境界は維持し、
新しい JSON 実体/marker 保存だけ Browser Adapter に置く。

## Workspace

`createServerTripWorkspaceSource` は get/refresh/retry と loading/loaded/unavailable を持つ read-only source。
古い取得応答は generation で破棄。再取得開始時に古い Trip を外し、stale 内容を current として使わない。
controller は source subscription で再描画し、コピーは read view であって編集正本ではない。

source の存在で `blocksLegacy()` を判定する。composition の onTravelPlan/onTripPlanUpdate、宿選択、
legacy panel 自体の reader/writer を gate。Agent 起動時も server Trip が不明なら legacy context へ戻さない。
既存 `tripId` session を再表示すると HTTP source へ接続するが、現在は公開 API がないため unavailable になる。
通常の legacy session は従来どおりで、勝手に migration しない。

server notice は「サーバの旅程を参照／変更案はまだ保存できない」。`confirmProposal` は供給しない。
既存 DEV-only source は従来どおりメモリ内確認で、「永続保存されない」と表示する。
候補採用、Proposal validation、Tool 選択、Evidence/Claim/Viewer policy は変更しない。

## Terraform / 確認

既存 AWS SDK/DynamoDB と Lambda package を再利用。新サービスや認証 Provider は増やさない。
専用 `${local.resource_prefix}-trips` table、on-demand、暗号化、PITR、削除保護、TTL なし。
短期の運行観測と異なり利用者の計画は再生成できないため、PITR の保存量に応じた費用を許容して回復性を優先する。
削除保護により意図しない destroy は失敗する。データ削除を含む解除は別の明示承認が必要。
既存 Lambda role にこの table ARN の GetItem/PutItem/UpdateItem/DeleteItem/Query のみを付与する。
Scan、全 table ARN、public all-trips API、auth 無し route は追加しない。将来 worker role も必要 table の最小権限で組成する。

`npm test/build/architecture:check/workspace:check/eval:agent:smoke/eval:agent:full`、Terraform fmt/validate、
`python3 -m unittest discover -s tests/infra -v`、`git diff --check` で確認する。
DynamoDB 試験は SDK command contract fake（live AWS CRUD 試験ではない）。Apply/deploy はしていない。
Agent Eval は既存 scripted/保存済み IO 評価。Runtime/Prompt/Tool 選択変更がないため Live 再実行なし。
既存の AWS 認証期限切れによる Live 未実施記録は維持する。

## #388 AC 自己レビュー

| 要件 | 確認先 |
| --- | --- |
| owner-scoped CRUD / schema/revision / invalid / archive | `dynamodb-trip-repository.test.ts` |
| principal 必須 / forged owner / cross-owner / logs / bounds | `trip-handler.test.ts` と Repository/Application 試験 |
| 会話 attach/detach/複数参照/削除生存/保存復元 | `conversation-trip-reference.test.ts`、Browser session test、Dynamo link test |
| valid/warning/deferred/原本/失敗/retry/read-back/marker/認証なし | `trip-migration-storage.test.ts` |
| pending gate → server source / preview-only | `trip-migration-workspace.test.ts` |
| refresh/race/error/retry/notice/二重 writer 拒否 | source/HTTP/Workspace DOM/legacy panel test |
| public route 閉鎖 / least-privilege IAM | `tests/infra/test_trip_storage.py`、handler default unavailable test |

後続: #389 CAS/revision/idempotency と writer rollout、認証 Provider の別レビュー、#398 Reservation、
#399 collaboration、#402 feasibility、TripWatch/Notification/offline sync。これらは今回の Close 対象ではない。
