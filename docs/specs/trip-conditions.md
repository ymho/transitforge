# TripRequest / PlanAssumption

今回の条件・人数・仮定はServer Trip V2のrequestが正本。Profile V3は3項目のreference-only hintで別resource。
会話の受理条件はServer working state / Applicationで解決し、本文やBrowser TripContextから正本を復元しない。
条件の変更で採用済みitems.scheduleを暗黙変更しない。user / assumption等の出所、hard / soft、scope、確認状態を保持する。
一次根拠: `modules/trip/domain/trip-request.ts` / `trip-request.test.ts`、`modules/agent/runtime/effective-intent.ts`、
`backend/agent-api/src/usecases/agent/conversation-condition-application.ts`と隣接test。
旧Profile field保持・converter・legacy実行経路は現行契約ではない。

保存・認可は[Trip保存](trip-persistence.md)、型契約は[Trip lifecycle](trip-model.md)を参照する。

## TripParty

## Domain契約

`modules/trip/domain/trip-party.ts`のTripPartyを同じTripRequestから参照する。

- adultsは非負safe integer、children配列長が子ども人数の唯一の正本。合計0/非safeを拒否する。
- 子どもは`{ age?: number; ageGroup?: ChildAgeGroup }`。`{}`もvalid。ageは非負safe integer。
- 既存TravelCompanion / ChildAgeGroupを再利用。Domainに年齢帯の数値定義はないので、
  baby=0〜2等の閾値やProviderのadult/child区分を新設しない。ageとageGroupから料金適合を証明しない。
- compositionは意味補助。未知値/重複、solo＋複数人を拒否する。partner/friends/familyから人数を生成しない。
- sourceはuser/profile/legacy/assumption。最後の値は既存constraintと同様、モデルの意味解釈に対応する。
  概念例からの補足は、#415のsource/assumptionIdを実装し、モデルをuserと偽らないことである。
- userはassumptionIdなし。その他は対応する非却下仮定への相互参照が必須。
  profile/legacyは同じsource、assumptionはmodelを参照する。confirmed後もsourceをuserへ変更しない。
- unknown fieldを拒否。氏名、メール、account ID、生年月日、Provider rawは格納しない。

## 確認・却下と明示ユーザー更新

`proposeAssumptionDecision`にoptionalなparty repair（remove / replace）を追加した。
既存item repairs・同じTripUpdateProposalを維持し、最終Requestとitemsをまとめて検証する。

- unconfirmed: 仮partyを保持できる。partyなしの未確認メモも許可するが、値がなければconfirmできない。
- confirmed: 同じparty値・source・参照を保持する。変更と確認を同時に偽装しない。
- rejected: partyのassumptionIdが却下仮定を参照したままなら拒否。
  元/最終RequestをDomainで比較し、source付け替え・子ども/キー順変更だけでは別partyとしない。
  明示removeまたは異なるuser partyへのreplaceを同じProposalで行う。
- 元snapshotがない単体validationは参照整合を検査し、値の置換比較はapply時の元/最終Requestで検査する。
  予約・schedule・state・revision・updatedAtを暗黙変更しない。
- 同じconfirm/rejectの再送はno-op。完了後の逆判断、retryで異なる置換値を送ることを拒否する。
- `proposeUserParty`はApplicationの明示user操作。旧party仮定のactive参照を外し、partyだけの未確認仮定は却下履歴へ残す。
  既にconfirmedの履歴は逆転させず、今回partyとの参照だけ外す。複数対象の仮定は他の参照を維持する。
- モデル用`propose_request_assumptions`は既知partyを書換え/削除できない。新規はmodel/unconfirmedのみ。
  意図の解釈はモデル、値と出所・Patch整合はコードが所有する。actorをモデルに公開しない。

## Context・表示・privacy

同じsnapshot/Decision ContextでpersistedTripRequest.party、unconfirmedAssumptions、travelProfileを分離する。
Context圧縮後もRequestの人数・未知年齢・参照は保持する。Profileで今回人数をflatten/上書きしない。
既存structured質問の対象にparty/child-ageを追加し、確定人数や既知exact ageの再質問を拒否する。
自由文regex/新state/固定質問順は追加しない。年齢不明でもProgress可能という判断原則をContextへ渡す。

`tripPartyLabel`/`tripPartyView`はpure projection。大人・子ども・年齢未確認・幼児・夫婦/友人を表示する。
夫婦/友人ラベルは明示compositionとadults=2・子どもなしの場合だけ。人数をラベルから逆算しない。
未確認は既存`⚠ 仮置き`へ接続し、Proposal応答にもpartyを表示する。全面DOM UIは#390。
氏名/メール/アカウントID/生年月日を追加せず、年齢も与えられた粒度だけを保持する。

## 旅程条件の単一正本化

Parent: #753 / Epic #751

## 正本と責務

採用済みの今回条件は`Trip.request`を正本とする。Conversation Working Stateのsemantic overlayは、
まだTripへ採用されていない条件操作だけを保持し、採用後に同じ値を第二の正本として残さない。
次回Agent Contextと条件パネルは、現在のTripと未採用overlayを同じEffective Intent compilerへ渡して導出する。

Strands Adapterは、同じtargetを以前呼んだという理由で成功を返さない。全ての条件操作をApplicationへ渡す。
永続化境界は、同一turn・target・payloadの再送を元のreceiptへreplayし、異なるpayloadの訂正や撤回を
新しい操作として保存する。自由文、固定文言、正規表現で再送や採用を分類しない。

## 受理からTrip採用まで

1. 条件ToolをApplicationが検証し、Working Stateのoverlayとoperation receiptを同じCAS transactionで保存する。
2. Server compositionは、現在のTrip、Effective Intent、accepted receiptからverifiedなrequest Proposalを決定論的に作る。
3. Proposalをturn leaseへstageし、Conversation・Trip・base revision・binding・accepted operationの一致を検証する。
4. Trip Applicationはdurable reservationを取得して既存Trip mutation receipt/CASで`Trip.request`を更新する。
5. Trip commit後に、採用したfact/tombstoneだけをoverlayから消費し、無関係な条件を保持する。
6. Trip保存とWorking State完了後だけ、公開receiptと「今回の相談条件（反映済み）」を返す。

Trip commit前の失敗ではreservationを解放する。Trip commit後に応答またはWorking State完了だけが失われた場合は、
同じmutation IDの再送でTrip receiptをread-backし、状態完了だけを冪等に再開する。Tripを巻き戻したり、
モデルを根拠に別mutationへ置き換えたりしない。別turnは未完了reservationが解消するまで更新できない。

同じturnで出発地と行き先など複数の独立条件を受理した場合、Proposal bindingは複数receiptを参照できる。
採用完了も最終receiptだけでなく、binding revisionまでの保存済みreceiptを横断して対象操作を検証・消費する。

## 部分条件とProfile

Trip Requirementへ完全には投影できない明示値は`Trip.request.partialConditions`へ保存する。

- 合計人数だけ: 同行者内訳を補わない。
- 通貨または対象が不明な予算: JPY、総額、1人当たり等を補わない。
- 終了日だけ: 開始日や泊数を補わない。

明示撤回では同じslotのconstraint/partial conditionを削除する。Profileの普段の出発地を今回だけ未定へ戻した場合は、
Profile自体を変更せず`Trip.request.profileSuppressions`へoriginの継承抑止を保存する。複数属性を持つ興味や移動条件は、
target単位で粗く一括抑止しない。

手動Trip編集はsemantic provenanceを引き継がない。次回相談は最新Tripをbaseとして読み、消費済みの古いoverlayを
再適用しない。Conversation/Trip/ownerの境界を越えてreceiptや条件をreplayしない。

## 表示と検証

条件パネルはTrip Requirementとpartial conditionを区別して表示し、未確定値へ架空の単位・内訳・日付を付けない。
認証済み`/api/agent-stream`から、条件受理、Trip保存、公開receipt、再読込、訂正、同一turn replayまでを検証する。
Repository境界では、同一再送、異なる訂正、撤回、複数条件、owner/turn分離、Trip commit後の応答喪失を検証する。

合成モデルの固定応答は保存契約の決定論的検証に使う。実Bedrock確認はTool反復や会話品質を別に測り、
合成結果だけを根拠に実モデルや外部Providerの品質を完了扱いしない。
