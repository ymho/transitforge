# Trip sharing authorization (#399)

正本方針: #382 / #415、[ADR 0065](../decisions/0065-authorize-trip-sharing-with-independent-resources.md)。
TripParty（同行者）と認証されたTripParticipant（アクセス権）は別概念。

## Before / After と既存入口

既存`TripPrincipal.subject`を認証hostから受け、`TripApplication.execute`のget/mutate/archive前に
`TripSharingApplication.authorize`を実行する。返された内部ownerだけを既存Repositoryへ渡す。
`Trip`の型・schemaVersion・PK・revision・receipt・outboxは変更しない。
クライアントDTOのowner指定は拒否し、query stringも受け付けない。

| 操作 | owner | editor | viewer |
| --- | --- | --- | --- |
| Trip参照 | 可 | 可 | 可 |
| 既存Proposal/CAS適用 | 可 | 可 | 不可 |
| archive | 可 | 不可 | 不可 |
| Grant発行/失効、参加者権限変更 | 可 | 不可 | 不可 |
| 自分のConversation | 従来どおり | 従来どおり | 従来どおり |
| ownerのConversation/Trace | 自分のみ | 不可 | 不可 |

ownerはactiveな既存owner storageから暗黙認可する。owner移譲なし、全件backfillなし。
非ownerはactive membership、provenance Grantの期限/失効、active Tripをstrong readで検証する。
不存在・別人・失効・期限切れ・権限不足は共通のnot-found。認証失敗は401。

## 独立resourceとquery

既存Trip tableに独立したstorageVersion=1 envelopeを追加する。
Trip JSONへmembership/tokenを入れず、shared Tripの複製も作らない。

| Resource | PK | SK | Query |
| --- | --- | --- | --- |
| Trip（変更なし） | `OWNER#subject` | `TRIP#uuid` | owner prefix |
| TripParticipant | `PRINCIPAL#subject` | `PARTICIPANT#tripId` | principal prefix |
| ShareGrant | `GRANT#grantId` | `GRANT#grantId` | GetItem |
| abuse counter | `PRINCIPAL#subject` | `SHARE-RATE` | GetItem、条件付きPut |

管理用の疎GSI `trip-sharing`は`shareTrip=JSON([ownerSubject,tripId])`、
`shareOrder=GRANT#id / PARTICIPANT#id`、KEYS_ONLY。
すべてのGSI候補をbase rowからstrong readし、owner/Trip/idを再照合する。
一覧は20件/page、参加者id検索は最大2件。Scanなし。inactive/revoked履歴も管理画面で表示する。
accessibleはmembership一覧、ownedは従来Trip一覧。どちらもサーバ再取得であり端末にTripをコピーしない。

## Secretと失効

- 32 random bytes（256bit）のbase64url secret。DBはSHA-256 hashのみ。
- `timingSafeEqual`で固定長比較。未知grantでもdummy hash比較、エラーに秘密値を含めない。
- raw secretは発行レスポンスと一時的なリンク/redeem入力に限定。発行response lost時は再取得不可。
  ownerは管理画面から不要Grantをrevokeして再発行する。
- fragment `#trip-share=tripId.grantId.secret`を使用。Composition起動直後にURLから消去。
  redeemは同一originの認証済みPOST、no-store/no-referrer。local/session storage、Agent、Traceに入れない。
- 有効期限は省略時7日、最大90日。redeemだけでなく由来membershipのaccessにも適用。
- Grant revokeは新規redeemと由来accessの両方を失効。参加者をfanout更新しない。
- ownerによる参加者取消後、同じGrantの再redeemで取消を迂回できない。
  owner再有効化でもGrantの失効/期限切れは迂回できない。別Grantの明示redeemは可能。
- 権限変更はparticipant resource version CAS。別人のprincipalはUI入力にしない。
- abuseはprincipalあたり毎分最大30 sharing操作。1 base rowを条件付き更新し、競合/障害はfail-closed。

## Mutationの原子性

editorも既存`TripUpdateProposal` / typed Patch / baseRevision / mutationIdを使う。
owner rev5→rev6の後にeditor rev5を適用すればconflict。silent merge/rebaseなし。
Trip Update + mutation receipt + TripChanged outboxと同じtransactionへ、
participant exact payloadとGrant exact payload/期限/失効のConditionCheckを追加する。
確認画面を開いた後のrole変更/revokeがcommitより先なら更新は失敗し、Trip/receipt/outboxは部分適用されない。
読取の認可はstrong authorization read時点。失効前に既に端末へ渡った情報を回収する機能ではない。
receipt再送でもApplicationで現在のaccessを検証する。
予約確認・in-trip fixed/hard確認・lifecycle確認・Feasibilityは既存prepare-before-CASのまま。
Grant redeemもactive Trip + current Grant + member CASのtransaction。response lostはbase再確認する。

## Resource privacy / UI / Agent

共有readはTripと明示的なReservationFact endpointのみ。予約番号/private provider値は返さない。
Checklist/Impact/Notification/Delivery/Push subscription/Trace/Conversationの既存APIを
participantのownerへ自動付け替えしない。未取得はunknownのままで、空の予約として扱わない。

共有管理panelはrole/期限指定、作成、取消、参加者一覧/権限変更、redeem、参加中Trip一覧を提供する。
shared openは新しい本人用Conversationで既存Trip Workspaceを表示する。
viewerは閲覧専用表示でwriter/confirmを無効化。相談用Proposal previewは保存しない。
editorの確認は既存ServerTripWorkspaceSource/ServerTripWriterを再利用し、保存前に最新Tripとroleを再取得。
Agentには`featureContext.tripRole`だけを追加し、owner/principal/secret/hashは追加しない。
ToolやPromptを変更せず、最終適用のsecurity boundaryはserver authorization。

## 公開gate / migration / 非対象

`createAuthorizedTripApplications`はtrusted authenticated host用composition。
public lambdaのTrip/sharing handlerには認証を注入せず、従来どおり**501 gate**。
リンクからの匿名参照や仮ownerによる動作はしない。公開認証Provider、session/CSRF検証、
confirmation authority、writer rolloutを別途レビューして接続する必要がある。
このPRでは公開利用/デプロイを有効化せず、同じApplication/RepositoryとSDK transaction fixtureで2利用者経路を検証する。

Trip migration、LocalStorage writer切替、shared merge、owner移譲、他resourceの自動共有はない。
Terraformは疎GSI/IAM Queryの追加のみでapplyしない。既存データを走査・変換しない。

## 検証責務

`trip-sharing-application.test.ts`:
owner→viewer→editor→CAS→revoke、旧envelope、IDOR、偽owner、wrong/expired/revoked/cross-Trip secret、
権限昇格拒否、response lost、失効commit race、GSI base verify、bounded query、予約/replan確認。
SDK fixtureはlive DynamoDBではないが式とtransactionのall-or-nothingを検証する。
frontendはsecret fragmentの消去、DTO allowlist、UI role/期限/取消/redeem、viewer confirm拒否、Agent roleのみを検証。
既存Agent Smoke/Full・AJ〜AU scriptedケースを変更せず維持。新しいLLM判断やLiveケースは追加しない。
