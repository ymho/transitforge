# ADR 0065: Trip共有を独立したParticipant/Grantで認可する

- ステータス: Accepted
- 対象: #399、親 #382/#415、前提 ADR 0052/0053/0054
- 日付: 2026-09-18

## inventoryと差分

| 現行 | #399の変更 | 再利用/変更しない責務 |
| --- | --- | --- |
| `TripPrincipal.subject` はtrusted host注入 | 同じprincipalからmembershipを認可 | 認証Providerを新設しない |
| `OWNER#subject / TRIP#uuid` | 認可結果だけから内部ownerへ解決 | Trip PK/schema/単一正本を維持 |
| `TripApplication.execute` get/list/mutate/archive | read/write/ownerの共通認可 | Proposal、baseRevision、mutationId、receipt、予約/replan確認 |
| archiveはstorage visibility | archive/missingは共有でもnot-found | cascade削除なし |
| Reservation/Checklist/通知/履歴はowner-scoped | 自動共有しない。必要時ReservationFactのみ | private APIのprincipalをownerへ置換しない |
| public Trip handlerは501 gate | 共有handlerもtrusted auth未接続なら501 | 無認証writer/仮ownerなし |
| owner-prefix bounded Trip一覧 | principal membershipのbounded Queryを追加 | Scan/backfillなし |

## 決定

Trip本体を共有PKへ移す案、Trip内participant配列、URL secretによる毎回readは採用しない。
既存Trip tableへ独立resourceを置く。principal membershipはbase Query、owner管理一覧は
疎な`trip-sharing` GSI（KEYS_ONLY）。GSIは候補に過ぎず毎回base rowをstrong readする。
追加table/認証SDKは不要で、既存Trip CAS transactionへmembership/grantのConditionCheckを加えられる。

ownerは既存storageから暗黙認可しbackfillしない。editorはProposal更新のみ、viewerはreadのみ。
archive/共有管理はownerのみ。拒否はnot-foundに統一し他Tripの存在を明かさない。
grantは256-bit random secretのSHA-256だけを保存しtiming-safe比較する。secretは発行時だけ返す。
リンクはfragmentにsecretを置き、redeemは認証済みPOST。URLをlog/Agentへ渡さない。
有効期限はredeemと由来membershipのaccess両方に適用する。revokeは由来accessも即失効させる。
participantはgrant provenanceを保持し、role変更でも失効を迂回しない。別grantの明示redeemで再参加可能。
owner管理のrole変更・participant取消はresource version CAS。owner移譲はない。

編集commitは既存Trip CAS/receipt/outboxとmembership version + grant version/有効期限を原子的に検証する。
revoke前に開始し後でcommitする編集も拒否する。読取は最後のstrong authorization readを基準とする。
receipt retryにも現在の認可が必要。共有用merge/rebaseはない。
redeemにはprincipal単位のbounded rate-limit seamを必須とし、秘密値やraw subjectはログに含めない。

## 実装順と対象

1. shared role/read-safe view契約、backend authorization port、同じTripApplicationの認可入口
2. DynamoDB participant/grant、hash生成Adapter、atomic fence、bounded query、Terraform sparse GSI/IAM
3. share handler/client、共有管理・redeem UI、同じWorkspaceのviewer/editor source、roleのみAgent context
4. 2利用者integration/security/CAS/失効race/DOM/既存Eval・全check

主要ファイルは`modules/trip/domain/trip-sharing.ts`、backend `ports/trip-authorization.ts`、
`usecases/trip-sharing-application.ts`、`adapters/dynamodb-trip-sharing.ts`、既存TripApplication/Repository、
frontend `usecases/trip-plan` / `presentation/trip-plan` / HTTP Adapter、`trips.tf`。
既存データの移行・全owner Scan・LocalStorage writer切替は不要。認証Providerと公開rolloutは
未決定のままgateを維持し、trusted hostを使うintegrationで共有一連を検証する。
Conversation・Trace・Notification delivery・予約private値の共有は対象外。
