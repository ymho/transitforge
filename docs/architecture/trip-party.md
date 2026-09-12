# TripParty (#411)

親方針は#382/#415、[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)。
PR #427をmainへマージした`394c058`から実装した。正本は同じ`Trip.request.party`のみ。
V2 writer/CASは未有効。現行画面のProfileやLocalStorageを今回のparty正本へ切り替えたわけではない。

## 棚卸し / Before → After

| 現行 | #411の扱い |
| --- | --- |
| TripPlanConditions.adults/children | legacy人数。既存converterで明示人数だけ同じTrip.request.partyへ移す |
| TripContext.companions | 人数ではなく構成。安全に結合できる場合のみcomposition、それ以外は未確認メモ/警告 |
| UserProfile.companions.usual/children | 普段の傾向として独立。明示的なProfile採用Proposal以外では今回partyへ写さない |
| TripRequest / PlanAssumption | 予約済みparty/affects.partyを完成。別aggregate/Repository/Contextは作らない |
| 宿のTravelProviderSearch / HttpAccommodationProvider | 現行はadults→adultNumのみ。子ども年齢を扱えると偽らず、V2人数変換は別のHTTP Adapter helperへ置く |
| RestaurantCandidate / RestaurantSearchRequest | 店の検索と人数条件は別。人数・年齢から架空の空席/料金を作らない |
| Agent / preview | 同じContext/Tool/Proposal/Ask + Progressを拡張。Profile、party、仮定は別fieldで保持 |

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

## Profile

`proposeProfileParty(trip, profile, adults, assumptionId)`は明示的な採用操作でのみ使用する。
adultsは呼出側が指定し、partnerから2人とは推測しない。Profileの子どもは既存ageGroupだけを写し、
source=profile/unconfirmedの仮定と結ぶ。既知partyがあればProfileによる上書きを拒否する。
userの明示値が今回の正本となり、Profileそのものは変更しない。

## 単一legacy converter

既存`convertLegacyTripPlan`内のRequest mappingのみ拡張する。

- 有効なadults/childrenは人数分の`{}`へ。legacy/unconfirmedで保持し年齢を捏造しない。
- adultsだけの旧入力は子どもなしを**未確認仮定**として明示し、欠落childrenをwarningに残す。
  adults欠落は0と推定せずparty未設定とする。
- 負数/小数/非数/総数0はparty未設定＋invalid warning。補正しない。
- countから新しい配列を割り当てるmigration境界だけ10,000人を上限にする。
  巨大な不信入力からのallocation/メモリ枯渇を避けるためであり、Provider制約やDomain上限ではない。
  超過はdeferred warningと原本保持で、切詰めない。Domain自体には任意の人数上限を置かない。
- companionsは有効な人数と矛盾しない時だけcompositionへ。単独なら人数不明のlegacy/unconfirmedメモに残す。
  solo矛盾等は人数を壊さず構成だけ未反映＋warning。Profileはmigration入力として混ぜない。
- considerationsは#387の自由文メモのまま。partyへ解釈しない。
- 同じ入力/引数なら同じ出力。原本不変、`requiresLegacyRetention: true`、writer/importは未実行。

## Provider / Ask + Progress

`frontend/src/adapters/http/trip-party-input.ts`は純粋な人数入力変換境界である。
操作側が`requiresExactChildAges`を指定し、countsだけなら未知年齢でも成功する。
exact age必須なら該当child indexだけを既存AskOnlyExceptionの`tool_input_missing`形式で返す。
ageGroup→fake age変換、profile値の補完、provider schemaのTrip正本化はしない。

実Provider APIの全面統合は対象外。現行宿Providerがexact age検索へ対応しているとは主張しない。
helperのmissingを得ただけでask-only例外の許可にはならない。本番Runtimeの既存検証は、当該実行の
登録Tool境界が実際に検出したmissingを要求し続ける。将来Provider接続時はこの検証へ接続する。
年齢不足はProvider操作単位の結果であり、候補探索/Activity/仮旅程のvalidationでは必須にしない。
質問するかはモデルが判断し、質問と具体Proposalを同じ応答で提示できる。

## Context・表示・privacy

同じsnapshot/Decision ContextでpersistedTripRequest.party、unconfirmedAssumptions、travelProfileを分離する。
Context圧縮後もRequestの人数・未知年齢・参照は保持する。Profileで今回人数をflatten/上書きしない。
既存structured質問の対象にparty/child-ageを追加し、確定人数や既知exact ageの再質問を拒否する。
自由文regex/新state/固定質問順は追加しない。年齢不明でもProgress可能という判断原則をContextへ渡す。

`tripPartyLabel`/`tripPartyView`はpure projection。大人・子ども・年齢未確認・幼児・夫婦/友人を表示する。
夫婦/友人ラベルは明示compositionとadults=2・子どもなしの場合だけ。人数をラベルから逆算しない。
未確認は既存`⚠ 仮置き`へ接続し、Proposal応答にもpartyを表示する。全面DOM UIは#390。
氏名/メール/アカウントID/生年月日を追加せず、年齢も与えられた粒度だけを保持する。

## 評価 / AC自己レビュー

| 受け入れ条件 | 検証 |
| --- | --- |
| 夫婦2人と大人2人＋幼児を別表現 | Domain union/label tests |
| 年齢不明でもvalid/候補を停止しない | `{}`、group only/exact only/both、Provider counts、Runtime N |
| Profileを自動確定コピーしない | Context未設定、profile proposal unconfirmed、user優先・原本不変 |
| 仮定の原子的確認/却下 | same party confirm、remove/replace、値付替え拒否、retry/逆判断/元Trip不変 |
| legacy安全移行 | adults only、人数/構成、不正値、allocation上限、pure/deterministic |
| Provider必須時だけage確認 | counts/exact mapping、missing index、fake ageなし、質問＋Proposalテスト |
| Context分離と既知条件 | 圧縮後のparty/Profile/assumption、既知質問拒否、Runtime M |
| writer未有効 | legacy保存・server・dual-write・会話削除差分なし |

既存Eval A〜Lを維持し、M（既知party）とN（unknown child age）を追加。SmokeはNも含む。
scriptedは同じproduction Runtime/registry/Domainを実行するが、実モデルの文章品質は保証しない。

```sh
npm test
npm run build
npm run architecture:check
npm run workspace:check
npm run eval:agent:smoke -- --output-dir /tmp/raiquora-411-smoke
npm run eval:agent:full -- --output-dir /tmp/raiquora-411-full
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case M-known-party --output-dir /tmp/raiquora-411-live-m
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case N-unknown-child-age --output-dir /tmp/raiquora-411-live-n
```

2026-09-13、既存AWSのSTS確認が`Your session has expired`で失敗したためLive未実施。
認証方式は変更せず、認証更新後に上記コマンドで再実行する。

検証結果: TypeScript 1,340件（frontend/modules 1,162 + backend 178）、build、architecture/workspace成功。
Smokeは保存済み12 + Ask 2 + Trip Progress 5、Fullは42 + Ask 7 + Trip Progress 14がすべて成功。
Python unittest 13件も成功。専用format/lintコマンドはなく、既存書式・型検査・差分空白検査を使用する。

共有/招待#399、Reservation#398、Money/fare#412、宿snapshot#400、UI#390、server#388、revision/CAS#389は対象外。
今回の差分は#411のみであり、それらのIssueをCloseしない。
