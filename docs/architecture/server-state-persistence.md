# Conversation / Profile Server保存・Context復元 — #479 Phase A/B

## 範囲とownership

保存境界は **#479 Phase A / persistence foundation** で導入した。
`TrustedPrincipal → ConversationApplication / ProfileApplication → Repository → DynamoDB`
に加え、**Phase B**でServer Context Loaderから共有Runtimeへ読み取り専用で接続する。
詳細は[Server Agent Context](server-agent-context.md)を参照する。認証済みRegional REST hostには
`/api/conversations/v1` と `/api/profile/v1` を接続し、専用Lambdaから同じApplication/Repositoryを利用する。
Browserには将来切替用のHTTP clientだけを追加する。既存Browser LocalStorageは引き続き現行の正本であり、本基盤とのdual-writeは行わない。

[ADR 0067](../decisions/0067-establish-trusted-principal-boundary.md)の検証済みissuer + subから得た
`TrustedPrincipal.subject`をそのままownerに使う。別identity hashやowner tableは作らない。
全Application/Repository操作でTrustedPrincipalを要求し、request body/headerのownerId、userId、
email、principalを権限根拠にしない。入力の許可field以外は拒否する。
型と構造検査は認証ではない。将来のtransportは#484の`authenticatedApplication`を通して
Access Tokenと`raiquora/user` scopeを検証し、request JSONをprincipalへcastしてはならない。
Profileは`@raiquora/trip/travel-profile`のUserProfile v2とvalidatorを再利用する。
未設定値、旧weight、notes、aiNoteFieldsを維持し、別Profile Domainは作らない。

## Keyとaccess pattern

既存AWS SDKを使い、Trip V2とは独立した`${resource_prefix}-server-state` tableを追加する。
新サービス/frameworkは追加しない。owner内の一覧・順序付き履歴・単一Profileというアクセスが
既存DynamoDBで実現できるため採用する。PAY_PER_REQUEST、保存時暗号化、PITR、table削除保護を有効にする。
既存Terraform fileは変更せず`server-state.tf`へtable、限定IAM policy、table名outputを置く。
Lambda環境変数とproduction routeは#480のcutover以降で組成する。

| Resource | PK | SK | 操作 |
| --- | --- | --- | --- |
| 会話metadata | `OWNER#<principal.subject>` | `CONVERSATION#<UUID>` | create/get、owner内prefix Query、metadata replace、delete fence |
| 会話message | 同上 | `MESSAGE#<conversationId>#<12桁sequence>` | metadataと原子的append、会話内range Query、物理削除 |
| Profile | 同上 | `PROFILE` | get、条件付きput/delete |

metadataはconversationId、ownerSubject、createdAt/updatedAt、revision、messageCountと
title/scope/summary/resolvedTopics/pendingTopics/optional tripIdを持つ。
messageはuser/assistantのtext、server timestamp、1からの連番を持つ。履歴全文やベンダー固有レスポンス、
Tool Trace、UI Stateをmetadataへ埋め込まない。Phase Aの本文契約はtextのみであり、
既存ViewerAgentResponseを無変換で保存・復元できると主張しない。
Phase Bは最近のtext履歴とsummary/topicsを復元する。Viewer固有の構造化応答の保存は後続とする。

全Get/Queryはstrongly consistent。Scan、他ownerのglobal lookup、GSIは使わない。
listはUUID順でmetadataだけを返す。更新日時順のUI一覧は本段階の契約に含めない。
list/historyのlimitは既定20、最大50。cursorは最後のUUID/12桁sequenceのみとし、
PKを受け取らず必ず現在のprincipalから再構成する。別ownerのcursorを持ち込んでもscopeは広がらない。
DynamoDBの1 MB page境界もLastEvaluatedKeyで継続する。
削除済みmetadataだけのpageは空配列とnextAfterになり得る。空配列だけを終了判定にしない。
履歴取得は読取り前後にmetadataを確認し、途中のdeleteはnot-found、更新はconflictとする。
Phase BのContext LoaderはmessageCountから末尾12件へseekし、取得後のmetadata revision再確認で
途中の変更をconflictにする。全文scanや更新中の暗黙再試行は行わない。

## 条件付き更新とサイズ

- 会話createはUUID（Applicationが生成）と`attribute_not_exists(pk)`で既存/削除済みIDの再利用を拒否する。
- appendはexpectedRevision必須。metadataのrevision CASと最大20 messageのPutを1 transactionにする。
  messageCountと本文は同時に進み、競合で部分保存しない。metadata updateも同じCASを使う。
- message textはUTF-8で16 KiB以下、metadataの文字数・topic件数も制限する。Profile JSONは64 KiB以下。
  DynamoDBの400 KB/item、100 item/4 MB transaction制限へ余裕を持たせる。
  履歴の総量は1 itemへappendせず分割し、1会話のsequence上限は999,999,999,999とする。
- Profile putのexpectedRevision=nullは未登録時だけのcreate、数値は該当live revisionのreplaceを意味する。
  ApplicationがupdatedAtをserver時刻に置き換える。delete/recreate後もrevisionを増やし、古い更新の復活を防ぐ。
- 応答喪失後のappend/put再送は成功の再現を保証しない。CASにより二重append/上書きを防ぎ、
  unavailable/conflict時はget/historyで結果を確認してから次の編集を作る。これらの低水準操作自体にはreceiptによるexactly-onceを導入しない。
  Phase Cの専用turn入口は[Conversation turn保存](conversation-turn-persistence.md)を参照する。

AWS制約の根拠は[DynamoDB constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)と
[TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)を参照する。

## Retention / delete

会話とProfileは明示削除まで保持する。自動archive/TTL/期間による削除は今回設けない。
これは保持期間が指定されていないPhase Aの前提であり、公開切替前に利用者向け保持方針を確定する。

会話deleteはexpectedRevisionでmetadataを本文なしのtombstoneへ原子的に置き換え、直ちにget/list/historyと
追記・更新から隠す。title/summary/topics/tripIdもこの時点で削除する。各呼出しで最大50 messageを
transactionで物理削除し、`{ complete: false }`なら同じprincipal/id/expectedRevisionで続行する。
途中障害も同じ引数で再試行できる。最後のpageを消して初めてcomplete=trueになる。
Phase Cではmessageに続けて最大50件のturn receiptも削除し、両者の削除完了をcomplete=trueの条件とする。
削除中のappendはmetadata CASで拒否され、削除済みIDの再createも拒否する。

呼出し元はcomplete=trueまで継続する責務を持つ。public delete endpointは同じCASで`complete`を返すが、
背景workerや中断後の自動再開は提供しない。中断時は非表示の本文がtableに残るため、durableな削除継続
（または削除完了を保証する実行境界）は後続で組み合わせる。
「非表示化成功」を「物理削除完了」と表示してはならない。

Profile deleteは1回の条件付きPutで本文を除去する。revisionとdeletedだけのtombstoneを残し、
同じアカウントの再登録時の世代fenceにする。会話/Profileのtombstoneはowner keyとrevisionだけを保持し、
TTLを設定しない。アカウント退会時の全件purgeは今回の操作とは別の後続契約である。
PITRの回復期間内には削除前のデータが残り得る。バックアップ復元時は削除要求を再適用してから公開する。
table削除保護はresource自体の破棄防止であり、利用者のitem削除を妨げない。

## Tripとの関係

conversation.tripIdは独立Tripへの参照であり、ownershipや共有権限を与えない。
Tripの存在/可視性は参照を辿る時に既存Trip Applicationで認可する。未存在・archive済み参照も自動修復しない。
会話削除・参照解除はTripを削除しない。既存Trip table内のConversation reference indexも変更しない。
Phase Bの読取ではConversation metadataのtripIdを使い、explicit tripIdと異なる場合はinvalid-inputにする。
既存Trip reference indexとの二重書込みは行わない。
Profile更新/削除は普段の希望だけを変更し、既存Trip、人数、予約、今回の制約を暗黙更新しない。
Context LoaderもTripRepositoryのgetだけを依存として受け取り、write-throughは行わない。

## Privacy / error contract

owner内で見つからない会話（削除済み含む）は、他利用者の実在IDと未存在IDで同じnot-foundを返す。
Repository getはundefined、Application getはnot-found、Profile未登録はundefinedとする。
conflictは当該ownerのrevision競合のみを表す。validationはinvalid-input、SDK/保存破損はunavailableとし、
下位例外cause、token、claims、raw itemや本文をエラーへ残さない。認証失敗は共通unauthenticatedになる。
ownerの有無を確認する全table検索やforbidden/他ownerへの存在照会は行わない。

生Profile、notes、会話本文/summary、tokenをログ・診断Traceへ出さない。
保存同意とモデルへ渡す同意は別で、aiNoteFieldsは保存したまま尊重する。Phase BのContext Loaderは
共有`createAgentContextSnapshot`を使い、同意したnotesだけを各240文字までモデルへ投影する。
保存した全文をそのままAgent/Traceへ送らず、stateful組成ではRuntimeの内容Traceとraw model-call Traceを抑制する。
本基盤は端末データの自動取込を行わず、別principalへの暗黙移譲もしない。

## 検証と後続cutover

対象testはSDK command/transaction fakeで検証する。#484のローカル署名Access Tokenを実verifierで検証し、
ApplicationからDynamoDB Adapterまで通したaccount isolationも含む。live AWS CRUDの代替とはしない。

```bash
npx vitest run backend/agent-api/src/adapters/dynamodb-conversation-repository.test.ts backend/agent-api/src/adapters/dynamodb-profile-repository.test.ts backend/agent-api/src/usecases/conversation-application.test.ts backend/agent-api/src/usecases/profile-application.test.ts
npm run test --workspace @raiquora/agent-api
npm run build --workspace @raiquora/agent-api
npm run architecture:check
terraform -chdir=infra/terraform/environments/dev fmt -check server-state.tf
terraform -chdir=infra/terraform/environments/dev validate
```

Phase BでServer Context Loaderと`MultiStepAgentRuntime`の接続を完了する。
Browserから渡す将来の契約はIDs + user input + bounded UI hintであり、会話/Profile/Trip本文を要求しない。
Server内部のstateful組成と認証済みread/write APIで動作し、production Browserの正本はまだ切り替えない。

#480以降へ残すもの:

- Phase Cで追加したturn保存入口のproduction接続、必要な構造化応答の保存、summary更新方針
- Browser切替、別tabの状態同期、保存・削除継続のUI組成
- LocalStorage正本停止。実利用者データ救済要否を明示確認し、必要なら明示import/read-backを設計する

Agent Eval、Frontend/root全量はこの変更のローカル検証に含めない。root全量はGitHub CIへ委ねる。
production cutoverとaccount isolationの本番相当E2Eは#480/#461で統合する。Issue #479全体は閉じない。
