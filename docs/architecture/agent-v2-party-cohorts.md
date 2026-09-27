# Agent v2: 同行者属性と参加範囲

Issue: #729。人数条件 #728 とは独立した `party_details` business slot。初回解釈の品質改善は #736。

## 受理する条件

`update_current_party_details(finalCohorts, quote)` を追加する。1回の呼び出しは、今回の相談における重複しない匿名集団の最終状態を1つの操作として受理する。属性ごとのToolや実名participantは作らない。既存の明示済み属性を維持した訂正も、この最終状態に含める。操作種別actionは設けず、`finalCohorts`に更新後に残す集合を渡して全体置換する。取消しと新しい詳細を同じ発言で指定した場合も、最後に残す集合だけを1回で提出する。`null`は最終状態が詳細未定の明示撤回であり、`party_size`は変更しない。これは内部の既存`cohorts|null`操作へそのまま写すだけで、別のcommitプロトコルは作らない。

- `count`、任意の `schoolStage`、`ageDecade`、`exactAge`。
- 学生区分: preschool / elementary / middle_school / high_school / university。
- 年代: teensからeighties、nineties_plus。学生区分と独立で、大学生かつ20代を保持できる。
- exactAgeは明示された値だけ。年代から正確な年齢、学校区分から年代や料金区分を補完しない。
- `membership=baseline` は既存の全体人数の内数であり、全行程参加を意味しない。`additional` は特定範囲で加わる外数。
- 集団の参加範囲を短くすることで途中離脱を表す。合計人数へ平坦化しない。全体人数が未確認なら詳細から全体人数を捏造しない。

全体と匿名集団の上限は20人。全体人数に矛盾する内数は拒否する。詳細受理後に全体人数が変更され矛盾した場合も、詳細を有効な料金・人数条件として使わない。

## 対話による確認と訂正

1要素は同じ人たちの人数・属性・参加範囲を一体で表す。属性の記録と参加日の記録に分割しない。既存の人の参加範囲を変更する時は、その要素を置換し、旧要素を別人として残さない。離脱後の不参加行や人数合わせの集団も生成しない。

変更対象の同行者や範囲が曖昧なら、モデルはwriterを呼ばず既存の`clarification(target=participation_scope)`で確認する方針とする。質問は実名を要求せず、既知の年代等で区別できる。確認を返す時はIntent revision、journal、保存済み条件を変えない。属性が既知でも、新しい発言の変更対象が確定しているとは限らない。ただし、モデルがこの方針に従わず対象未確定の発言で更新する実例があり、初回解釈の完全性は達成していない（#736）。

受理済み条件は保存の正本だが、モデルの意味理解が正しかった証明ではない。ユーザーが誤解や重複を指摘した場合は、新しいturnの通常の条件更新で訂正後の最終集合を受理する。無関係な同行者、明示済み属性、全体人数は維持する。以前のturnの再送で訂正を取り消せないことは既存journal/CAS/replayの責務である。

Applicationに発話regexや同じ属性の自動dedupeを追加しない。同じ属性を持つ別人は存在でき、属性一致だけで同一人物と判断できない。意味理解・確認・訂正の判断はモデル、値の妥当性と保存の一貫性はApplication/Domainという境界を保つ。

## scopeの権限とcurrentness

Tool入力は `whole_trip`、`logical_days(fromDay?, toDay?)`、`segment(segmentNumber)` のみ。raw Trip/day/segment IDを受け付けない。

Applicationがowner-scoped Tripを読み、そのrevisionのlogicalDaysと`projectTripStructure`から番号付きの選択肢を作る。fromDay省略は初日、toDay省略はその既知Tripの最終日。日範囲は両端を含む。日も区間も存在しない場合にモデルで新設しない。Tripがない相談で限定範囲を受理せず、対象Trip/範囲の確認を返す。

永続化するscopeはApplicationが解決したTrip ID・revision・day IDs/segment IDを保持する。モデル入力後にTripが変更されたら再解決してすり替えず拒否する。保存済みscopeが現Tripと異なる場合も未確認とする。日時や料金ルールの推測による補完はしない。

訂正用の`application.currentPartyDetails`は、保存済みの属性を保持し、scopeをToolと同じ番号形式へ投影する読み取り専用データである。モデルにraw IDの逆変換を任せない。stale・未知・非連続scopeは広げずnullとする。Domainで解決してからdata-only serializerへ渡し、別の永続ストアは作らない。

純粋Domainの`projectPartyAtScope`は、その日または区間に存在する人数と属性未確認の残りのbaselineを返す。dayとsegmentの対応を推測せず、異なる粒度への変換は未確認とする。

既存のglobal人数だけを扱うread Toolには、限定scopeの人数を暗黙変換して渡さない。V2の人数依存readerは`product_participation_scope_required`で止める。weather等、人数非依存の調査は止めない。既存read Toolへの商品・日程別の人数投影は、条件系の横断結合段階で接続する。

## 資格と追加質問

学校区分・年代・exactAgeは利用者属性であり、鉄道のこども料金、お子様メニュー、学割、シニア割の資格ではない。

`assessCohortEligibility`はApplicationが確認した特定Provider/商品のルールと照合する純粋Domain境界である。Provider・商品・有効期間・Evidenceが一致しない、ルールがない、必要属性が足りない場合は未確認。年齢範囲、学校区分、商品のexactAge必須条件を扱う。現実の事業者ルールをハードコードしない。

年代の全域が確認済みの年齢範囲を満たす場合はexactAgeを追加収集しない。閾値と重なる時だけ不足属性として返す。例: 合成テストの65歳以上条件に70代は追加年齢不要、60代はexactAgeが必要。これは実在商品の条件ではない。

この変更は既存Providerから資格ルールを自動認定するものではない。verified ruleをモデルに生成させるToolも作らない。商品に必要な全条件が確認済みでない限り資格を確定しない。料金・制限・推薦に必要になった時だけ、該当する匿名集団の不足属性を確認する。初回の年代/学年/年齢アンケートは行わない。

## 実行・保存・replay

Strands標準`tool()`、sequential executor、structured outputをそのまま使う。V1 runtime/interpreter/prompt/testsをoracleにしない。意味理解とTool選択はモデル、値検証・scope解決・owner/auth・CAS・replayはApplication/Domain。

`condition:<turnId>:party_details`が操作ID。cohorts全体は1 Intent operation、1 group、1 receipt、1 revisionで既存journal/CASへcommitする。匿名集団の順序はidentityではないため正規化する。異なるTrip revisionへのretryは異なるpayloadとなり、既存の同一ターン操作を上書きできない。A commit後のB失敗、再送、古いターンの書き込みを既存のfencingで防ぐ。

既知の受理拒否は`ok=false`、`conditionAccepted=false`、`retryable=false`を持つTool結果で返す。scope不足・不明・staleの場合は不足入力`participation_scope`も返し、モデルが確認を選べるようにする。Applicationは再試行や最終回答を強制しない。不明な永続化エラーは従来通りreadとpublicationを閉じる。

what-ifは`consider_trip_scenario(kind=party_details)`。scope解決と値検証は共用するがwriter callbackを呼ばず、Intent revision、journal、Profile、Tripを変更しない。成功後にactualを「元に戻す」writerを呼ばない。

Trip/Profile writer、予約、決済は接続しない。Profileへ常設同行者情報を増やさない。旧`TripParty`/`participants`やプロフィール保存型に年代を押し込まない。

## 検証とリリース判断

決定論的検証は`npm run test:agent:v2`、Smoke、full CIで行う。独立属性・資格、owner-scoped scope解決、現在値投影のround-trip、CAS/replay、production-shaped経路、条件の訂正・確認時の非更新を含む。

利用者の「初回に完璧な解釈を要求するより、確認や訂正から正しく復旧することを重視する」という方針に合わせ、liveを明示的に分ける。

- `party-details`: 厳密な初回解釈probeを含む全5fixture、22ターン。従来の10発言・保存期待値、曖昧対象の初回確認期待は変えない。現時点では未通過の品質測定であり、#736で改善する。3反復の最大model callsは396。
- `party-details-dialogue`: 保存済み重複の訂正、曖昧対象への補足と再訂正、複合撤回の誤解からの訂正を扱う3fixture、9ターン。3反復で最大162 model calls。先行する初回解釈は良否を記録し、その後の明示的なユーザー訂正で正しい値に到達することを合否にする。初回の品質失敗を成功と呼び替えない。

対話完了gateでも、各turnのglobal人数・無関係な条件の維持、同一slotのcommit上限1、revisionとcommit数の一致は必須。明示的な訂正後の保存値・1操作・返答完了は厳密に照合する。what-ifはwriter callback 0かつ状態不変、不明scopeは未受理を要求する。確認を返す場合にも同時の書き込みを許容しない。単なる拒否済みToolの余分な選択は保存成功とは扱わず、実際のcommitとcallbackを検証する。

実行例:

```sh
AGENT_V2_LIVE=true MODEL_ID=jp.amazon.nova-2-lite-v1:0 npm run test:agent:v2:party-details-live
AGENT_V2_LIVE=true MODEL_ID=jp.amazon.nova-2-lite-v1:0 npm run test:agent:v2:party-details-live -- --testNamePattern 'recovers from|dialogue completion'
```

どちらも1ターン最大6 model calls・60秒で、実Providerやproduction stateへは書き込まない。fixtureはユーザーの後続発言を別turnで実行するだけで、runtimeへの自動repairやretryを追加しない。

厳密な初回probeのrun `36294025636`では、元の10ターンは2/3成功、重複訂正は3/3成功、対象未確定時の確認は0/3だった。対話完了gateの成功とこの未達項目は、PRと#736で別々に報告する。受理した条件が利用者に見えづらい表示の問題も#721/#736で扱う。固定fixtureの成功を未知の全発話に対する保証とは扱わない。

### 対話契約の更新

自由文・受理内容表示・履歴込みの短い訂正を[公開回答境界](agent-v2-publication.md#対話の自由文と受理済み条件729--736)へ追加した。
従来fixtureにも直前の公開会話履歴を渡す。callbackの完全一致ではなく、受理されたoperationと
revisionを検証する。`clarification`という返答種別だけで全条件の更新を禁止しない。
未確定の同行者は保留し、同じ発言で出発地だけ変更できることをproduction-shaped fixtureで確認する。
初回解釈probeと、明示訂正後の保存結果の区別は維持する。
