# V2の条件更新Tool

## Applicationの契約

現在のscopeはConversationの行き先・出発地・globalな人数条件・旅行期間・予算。Tool自体はConversationの条件journalを更新する。採用済み条件のTrip反映は[条件の正本](trip-conditions.md)のApplication commitを通し、予定・Profile・予約・決済は暗黙変更しない。型と許可項目はZod、根拠が今回の発言に含まれることと地名がその根拠に含まれることはApplicationが確認する。仮定や比較を変更と扱うかはモデルの意味理解を実モデル試験で評価する。部分文字列検証だけで意味理解を証明したとは扱わない。

1操作の正体は、このuser turnにおける1条件の最終意思決定。Applicationが `condition:<turnId>:<target>` を識別子にする。同じ条件/同じ値の再送は元receiptを返し、同じslot/別値は競合とする。異なる値へさらに変更したい場合は次の利用者turnで行う。モデルのtoolUseId、呼出順、再試行attemptに依存しない。

独立した条件は同一turnで複数確定できる。旅行期間はstart_date/end_date/durationを1つのbusiness slotとして扱い、1 receipt内の同一atomic groupで更新する。この実装を一般的な任意patch engineへ拡張しない。

## 永続化と回復

既存TURN recordにversion 1のoperation journalを追加する。個々のreceiptとWorking overlayを既存DynamoDB transaction/CASで原子的に保存する。別テーブル・別Intent正本は作らない。

- 最初の更新が成功し次が失敗しても、成功した操作は保持する。
- 同じ操作の再送で二重適用しない。元receiptを返した後もContext Loaderは現在の正本を読み、古いsnapshotへ戻さない。
- 保存結果が不明な失敗では後続read/公開を閉じる。新しい試行はjournalから再開する。
- 完了済みturnは保存済みB結果をreplayする。未完了の古いturnは後続turnの条件を上書きしたり、新しい回答を保存したりできない。
- journalがない旧intentReceipt付きturnは旧形式として再生するが、新しい複数更新のturnとして再解釈しない。
- 既存の単数public semanticReceiptは操作receipt群から作る表示用summaryであって、新たなmutationや正本ではない。

## Scenario

仮定値は永続writerへ流さず、非永続の`consider_trip_scenario`へ集約する。party/date/budgetごとにwhat-if Toolを増殖させない。予算のcurrency/basisも同じApplication groundingを通し、モデルの推測をscenario factとして権威化しない。このToolはA commit、Intent revision、Profile、Tripを変更しない。

## 予算条件

### 境界

予算は今回の旅行条件であり、Profileの恒久的な予算感から補完しない。モデルへ公開する永続変更操作は`update_current_budget`の1つだけ。

- `action=set`: 今回の予算を設定・訂正する。
- `action=clear`: 今回の予算を明示撤回する。

what-ifは既存の非永続`consider_trip_scenario`へ追加し、budget専用scenario Toolは作らない。

### Model inputとApplication authority

モデル入力はamount、任意currency、任意basis、外側quoteだけ。

- amountは通貨のmajor unit。5万円は50000、500ユーロは500。
- currencyはJPY/EUR/CHF/USD/GBP/KWDのうち、利用者が通貨を明示した場合だけ候補として渡す。
- basisは`trip`または`per_person`のうち、利用者が旅行全体/1人あたりを明示した場合だけ候補として渡す。

Applicationはモデル値をそのまま権威にしない。

- quoteは現在のuserMessageの完全な部分文字列でなければならない。
- amountはquote内の金額表現と一致する必要がある。万/千は決定論的にmajor unitへ展開する。
- 円/ユーロ等がquoteに無ければモデルがcurrencyを付けても保存しない。
- 「全部で/総額/合計/全体で」等が無ければtrip basisを保存しない。
- 「1人あたり」または金額に結び付いた「1人5万円」等が無ければper_personを保存しない。
- currency/basisが不明でもamount自体がgroundedならConversation条件として保持できる。
- 「くらい/程度/ほど/前後/目安」はoperation precisionをapproximateとし、それ以外はexactとする。

### Downstream projection

Conversationの`IntentValue.money`はcurrency/basisを任意で保持できる。しかしTripのbudget requirementは金額・通貨・basisが揃って初めて比較可能である。

したがって`proposeVerifiedIntentRequest`は、

- supported currencyがある
- basisが`trip`または`per_person`として確認済み

の場合だけTrip budget constraintへ投影する。basis未確認を従来のように暗黙のtripへ変換しない。

### Journal / replay

business slotは`budget`。既存condition journal/CASをそのまま使う。

- mutationId: `condition:<turnId>:budget`
- same turn + same final budget: receipt replay
- same turn + different budget: conflict
- later turn: correctionとして新しいslot
- clear: budget targetだけretract
- SDK toolUseId/model cycle/call orderは冪等キーにしない

### Scenario

`consider_trip_scenario(kind=budget)`は予算what-ifを非永続で扱う。Application側でamount/currency/basisを同じgrounding規則へ通すが、A commit、Intent revision、Profile、Tripは変更しない。

## 同行者条件

### 境界

同行者は今回の旅行条件であり、常設Profileの普段の人数・同行者から自動補完しない。

永続変更操作は`update_current_party`の1つだけ。

- `action=set`: 今回の人数・同行者構成を設定または訂正する。
- `action=clear`: 今回のparty条件を明示撤回する。

訂正をclear→setへ分けず、そのturnでのpartyの最終状態を1回で受理する。

仮定・反実仮想・what-if・シナリオ比較は汎用の`consider_trip_scenario`を使う。このToolはpartyや旅行期間などの仮定を検証してモデルへ返すだけで、A commit、Intent revision更新、Profile/Trip更新を一切行わない。条件ごとにscenario Toolを増やさず、比較の置き場を永続writerへ兼用しない。

Strands標準`tool()`とZodを使う。Tool callbackは#724の共通Conversation条件Applicationへ渡すだけで、別Agent loop、意味解析model call、repair、強制ToolChoiceを追加しない。

### 値

`update_current_party(action=set)`は2種類の値を区別する。

#### count

利用者が「2人」のように合計だけ明示した場合。

```text
party.kind = count
people = 2
```

Conversation Intentでは既存の`quantity / people`へ保存する。大人2人、成人1人+子1人等へ変換しない。

#### composition

利用者が大人/子どもの人数を明示した場合。

```text
party.kind = composition
adults = 2
children = 1
```

Conversation Intentでは匿名の`kind=party`へ変換し、子どもの人数だけ空要素として保持する。年齢・年代・家族/友人等の関係性はこのToolのSchema自体に置かないため、モデルが任意に補完できない。具体的なProviderが年齢を必要とする段階で、確認済み詳細を扱う別の業務操作を追加する。TripPartyと同じ基本整合性をDomainで検証するが、Tripへの採用は共通の条件Application commitが所有する。

### 一操作の理由

大人2人・子1人を「合計人数」「大人数」「子ども数」等の別writerへ分けると、一部成功時に矛盾した同行者状態を作る。そのためparty全体を1つの業務slotとして受理する。

同じuser turnのparty slotは1つ。Application-ownedな`condition:<turnId>:party_size`で識別し、SDK toolUseId、モデルcycle、呼出順を冪等キーにしない。

- 同じslot・同じ最終状態: receipt replay
- 同じslot・別状態: conflict
- 後続turnの訂正: 新しい操作として受理
- 明示撤回: tombstone
- 仮定・比較: writerを呼ばない

### Profile

人数・同行者・子どもの年代はtrip-specificであり、Profile V3の3項目から補完しない。Profileの保存データをこの操作で変更せず、会話からのProfile writerも公開しない。

### 詳細な年代・参加scope

年代・学年・途中参加は[TripParty](trip-conditions.md)の詳細条件として扱う。小学生/中学生/高校生/大学生と20代/30代等は同一enumに潰さず、学校区分と年代を独立した匿名属性として必要時だけ確認する。Providerごとの「こども」「学割」「シニア」資格へ直接昇格せず、確認済み商品ルールと照合する。途中参加・途中離脱は全行程人数を上書きせずlogical day/segment等の限定scopeとして扱う。

## 旅行期間条件

### 境界

開始日・終了日・日数は、モデルから見れば別々のwriterではなく、今回の旅行期間という1つの業務条件である。

モデルへ公開する永続変更操作は`update_current_travel_period`の1つだけ。

- `action=set`: 今回の旅行期間の最終状態を設定・訂正する。
- `action=clear`: 今回の旅行期間全体を未定へ戻す。

start/end/durationを複数Toolへ分けない。1回の呼出しをApplicationが1つのbusiness slot `travel_period`として受理し、Domainではstart_date/end_date/durationの最大3操作へ展開する。3操作は同じgroupIdを持ち、1 receipt / 1 DynamoDB transaction / 1 Intent revisionで原子的に適用される。

### Model input

検索依頼に新しく述べた実際の人数・日程も条件writerで受理してから検索する。登録という別指示を待たず、受理済みで変わらない条件だけを再利用する。

`action=set`のperiodには利用者が今回の発言で明示した全要素だけを一度に入れる。例えば「2026年10月24日から25日の1泊」は省略表記の終了日25日も含め、start/end/durationの全体をquoteに含める。省略した要素は未設定へ戻し、以前の期間値と黙って混在させない。

日付入力は`calendar_date`または`relative_date`だけとする。

- `calendar_date`: dayは必須。monthは明示された場合、またはendがstartと同月で日だけ明示された場合に使う。yearは利用者が年を明示した場合だけ権威を持つ。
- `relative_date`: 今日 / 明日 / 明後日。

旅行期間全体のquoteを唯一のsource substringとして使い、Applicationがそこに月・日・泊数/日数が実在するか決定論的に検証する。前turnのdurationなど、今回発言に根拠がない任意要素は今回のperiodへ持ち越さない。モデルへ日付ごとのquote切り出しは要求しない。

年が明示されていない月日は、Applicationがtrusted `calendarDate`を基準に**その日以降で最初に到来する月日**へ機械的に解決する。たとえば基準日2026-09-26なら12/25は2026-12-25、1/21は2027-01-21である。モデルが推測したyear値は対応する部分quoteに年が無ければ無視する。明示年がある場合だけその年を使う。相対表現にcalendar anchorが無ければ受理しない。

日数は`days`または`nights`で、今回発言に明示された整数だけを受け取る。

### 整合性

- startとendが両方ある場合、end < startは拒否する。
- start/end/durationがすべて明示されている場合、nightsは日付差、daysは両端を含む日数と一致しなければ拒否する。
- start+durationだけからendを生成しない。
- start+endだけからdurationを生成しない。
- 期間全体のclearはstart_date/end_date/durationを同一atomic groupでretractする。

これらはAgentの意味理解を補修する規則ではなく、Applicationが受理できる旅行期間の業務整合性である。

### Journal / replay

condition journalの永続形式は既存version 1を維持する。既存の`target`フィールドはbusiness slotとして読み、origin/destination/party_sizeの既存receiptもそのまま読める。

`travel_period`だけは1 journal entryに3 receipt operationsを持つ。

- mutationId: `condition:<turnId>:travel_period`
- groupId: mutationIdと同じ
- operationId: `<mutationId>:start_date|end_date|duration`

同じturn/slot/同じ最終状態はreceipt replay、同じslot/異payloadはconflict。SDK toolUseId、モデルcycle、呼出順は業務IDに使わない。

### Scenario

仮定・反実仮想・what-ifは永続writerへ流さず、partyと共通の`consider_trip_scenario`を使う。このToolはA commit、Intent revision、Profile、Tripを変更しない。

## 公開Toolと操作単位

モデルへは`update_current_destination`、`update_current_origin`、`update_current_party`、`update_current_travel_period`、`update_current_budget`を公開する。strict schemaとApplicationが今回の利用者発言のquoteを検証する。`set`は指定・訂正、`clear`は明示撤回。同じturn・同じtargetの最終意思決定を一操作とし、訂正をclear→setへ分けない。比較・仮定は永続変更の根拠にせず、非永続の`consider_trip_scenario`へ渡す。

一つのslotに同じ値を再送した場合は元receipt、別値はconflict。モデルのTool ID・順番・attemptに依存しない。期間の開始・終了・durationは一つのatomic groupにする。根拠が今回の発言に含まれることの検査と、肯定・否定・仮定の意味理解品質は別に評価する。
