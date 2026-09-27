# Agent v2: 同行者属性と参加範囲

Issue: #729。人数条件 #728 とは独立した `party_details` business slot。

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

変更対象の同行者や範囲が曖昧なら、モデルはwriterを呼ばず既存の`clarification(target=participation_scope)`で確認できる。質問は実名を要求せず、既知の年代等で区別できる。確認中はIntent revision、journal、保存済み条件を変えない。属性が既知でも、新しい発言の変更対象が確定しているとは限らない。

受理済み条件は保存の正本だが、モデルの意味理解が正しかった証明ではない。ユーザーが誤解や重複を指摘した場合は、新しいturnの通常の条件更新で訂正後の最終集合を受理する。無関係な同行者、明示済み属性、全体人数は維持する。以前のturnの再送で訂正を取り消せないことは既存journal/CAS/replayの責務である。

Applicationに発話regexや同じ属性の自動dedupeを追加しない。同じ属性を持つ別人は存在でき、属性一致だけで同一人物と判断できない。意味理解・確認・訂正の判断はモデル、値の妥当性と保存の一貫性はApplication/Domainという境界を保つ。すべての初回理解の完全性ではなく、曖昧な時の非更新と、ユーザーの補足・訂正から正しく復旧できることも受入対象とする。

## scopeの権限とcurrentness

Tool入力は `whole_trip`、`logical_days(fromDay?, toDay?)`、`segment(segmentNumber)` のみ。raw Trip/day/segment IDを受け付けない。

Applicationがowner-scoped Tripを読み、そのrevisionのlogicalDaysと`projectTripStructure`から番号付きの選択肢を作る。fromDay省略は初日、toDay省略はその既知Tripの最終日。日範囲は両端を含む。日も区間も存在しない場合にモデルで新設しない。Tripがない相談で限定範囲を受理せず、対象Trip/範囲の確認を返す。

永続化するscopeはApplicationが解決したTrip ID・revision・day IDs/segment IDを保持する。モデル入力後にTripが変更されたら再解決してすり替えず拒否する。保存済みscopeが現Tripと異なる場合も未確認とする。日時や料金ルールの推測による補完はしない。

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

## 検証

- `npm run test:agent:v2`: Domainの独立軸・scope・資格、SDK Tool/what-if、journal/replay/CAS、認証済みproduction-shaped経路、保存済み誤解の訂正・確認時の非更新を含む。
- `npm run eval:agent:smoke`、`npm test`、`npm run build`、通常CI。
- `AGENT_V2_LIVE=true MODEL_ID=jp.amazon.nova-2-lite-v1:0 npm run test:agent:v2:party-details-live`。
- `Agent Eval / Strands v2 Live` の `party-details` は14ターン、1/3独立反復、1ターン最大6 model calls、60秒。3反復の上限は252 model calls。実Provider/production stateへの書き込みはない。

liveの従来10ターンは大学生かつ20代、小学生のexactAge未確認、途中離脱、途中追加、what-ifのwriter callback 0、区間参加、詳細撤回、挨拶/お礼、Trip未解決を確認する。入力と保存結果の期待値は維持する。独立した合成状態から、以前の重複保存をユーザー訂正で解消する1ターンと、曖昧な変更対象の確認→回答の受理→再訂正の3ターンを追加する。確認とwhat-ifではwriter callback 0・状態不変、実際の訂正では1操作・1revisionと無関係な条件の維持を検証する。

決定論的テストは実モデルの意味理解を証明する代わりではなく、liveと別のゲートである。固定ケースの成功を未知の全発話で完全に理解できる保証とは扱わない。
