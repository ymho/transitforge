# Agent v2の今回同行者条件

関連: #716 / #724 / #727 / #728。V2基準モデルはADR 0098のNova 2 Lite。

## 境界

同行者は今回の旅行条件であり、常設Profileの普段の人数・同行者から自動補完しない。

永続変更操作は`update_current_party`の1つだけ。

- `action=set`: 今回の人数・同行者構成を設定または訂正する。
- `action=clear`: 今回のparty条件を明示撤回する。

訂正をclear→setへ分けず、そのturnでのpartyの最終状態を1回で受理する。

仮定・反実仮想・what-if・シナリオ比較は汎用の`consider_trip_scenario`を使う。このToolはpartyや旅行期間などの仮定を検証してモデルへ返すだけで、A commit、Intent revision更新、Profile/Trip更新を一切行わない。条件ごとにscenario Toolを増やさず、比較の置き場を永続writerへ兼用しない。

Strands標準`tool()`とZodを使う。Tool callbackは#724の共通Conversation条件Applicationへ渡すだけで、別Agent loop、意味解析model call、repair、強制ToolChoiceを追加しない。

## 値

`update_current_party(action=set)`は2種類の値を区別する。

### count

利用者が「2人」のように合計だけ明示した場合。

```text
party.kind = count
people = 2
```

Conversation Intentでは既存の`quantity / people`へ保存する。大人2人、成人1人+子1人等へ変換しない。

### composition

利用者が大人/子どもの人数を明示した場合。

```text
party.kind = composition
adults = 2
children = 1
```

Conversation Intentでは匿名の`kind=party`へ変換し、子どもの人数だけ空要素として保持する。年齢・年代・家族/友人等の関係性はこのToolのSchema自体に置かないため、モデルが任意に補完できない。具体的なProviderが年齢を必要とする段階で、確認済み詳細を扱う別の業務操作を追加する。TripPartyと同じ基本整合性をDomainで検証するが、Tripへの採用はこのsliceでは行わない。

## 一操作の理由

大人2人・子1人を「合計人数」「大人数」「子ども数」等の別writerへ分けると、一部成功時に矛盾した同行者状態を作る。そのためparty全体を1つの業務slotとして受理する。

同じuser turnのparty slotは1つ。Application-ownedな`condition:<turnId>:party_size`で識別し、SDK toolUseId、モデルcycle、呼出順を冪等キーにしない。

- 同じslot・同じ最終状態: receipt replay
- 同じslot・別状態: conflict
- 後続turnの訂正: 新しい操作として受理
- 明示撤回: tombstone
- 仮定・比較: writerを呼ばない

## Profile

Profileに残る旧`usualPartySize`、同行者、子どもの年代はtrip-specificとしてAIの今回条件へ投影しない。Profileの保存データをこの操作で変更せず、会話からのProfile writerも公開しない。

## 検証

決定論的テストではcount/composition/撤回、operation journal replay/conflict、Trip/Profileより今回条件が優先されることを検証する。

実モデルはNova 2 Lite＋固定Provider＋テスト保存先で、明示人数、構成訂正、仮定で永続更新しないこと、撤回を検証する。初期liveでは年齢未定から年代を補完する挙動と、仮定比較で永続writerを呼ぶ挙動を観測した。個別語句の補修ではなく、年齢・関係性をwriter Schemaから外し、永続writerと非永続scenario Toolを責務分離した。固定Providerの成功を実Providerや実ブラウザの成功とは扱わない。

最終party-only live run 36277632302ではNova 2 Liteを3回独立実行し、3/3 PASSした。各反復で、挨拶は更新なし、合計人数設定は`update_current_party`、大人/子ども人数への訂正も同writer、what-if「もし4人なら」は`consider_trip_scenario`のみでaccepted operation数を増やさず、明示撤回は`update_current_party(action=clear)`、お礼は更新なしとなった。


## 詳細な年代・参加scope

年代・学年・途中参加は#729で扱う。小学生/中学生/高校生/大学生と20代/30代等は同一enumに潰さず、学校区分と年代を独立した匿名属性として必要時だけ確認する。Providerごとの「こども」「学割」「シニア」資格へ直接昇格せず、確認済み商品ルールと照合する。途中参加・途中離脱は全行程人数を上書きせずlogical day/segment等の限定scopeとして扱う。

## 同行者属性・参加範囲

年代・学校区分・限定参加は別の `party_details` business slotで扱う。人数Toolへ属性を追加せず、詳細から大人/子ども内訳を推測しない。[#729の契約](agent-v2-party-cohorts.md)を参照。
