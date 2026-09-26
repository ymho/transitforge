# Agent v2の今回同行者条件

関連: #716 / #724 / #727 / #728。V2基準モデルはADR 0098のNova 2 Lite。

## 境界

同行者は今回の旅行条件であり、常設Profileの普段の人数・同行者から自動補完しない。

モデルへ公開する変更操作は次だけ。

- `set_party`: 今回の人数・同行者構成を設定または訂正する。
- `clear_party`: 今回のparty条件を明示撤回する。

Strands標準`tool()`とZodを使う。Tool callbackは#724の共通Conversation条件Applicationへ渡すだけで、別Agent loop、意味解析model call、repair、強制ToolChoiceを追加しない。

## 値

`set_party`は2種類の値を区別する。

### count

利用者が「2人」のように合計だけ明示した場合。

```text
party.kind = count
people = 2
```

Conversation Intentでは既存の`quantity / people`へ保存する。大人2人、成人1人+子1人等へ変換しない。

### composition

利用者が大人/子どもの内訳を明示した場合。

```text
party.kind = composition
adults = 2
children = [{}]
```

Conversation Intentでは`kind=party`として保持する。子どもの`age`/`ageGroup`は利用者が明示した場合だけ保持し、未確認を数値や年代へ変換しない。TripPartyと同じ基本整合性をDomainで検証するが、Tripへの採用はこのsliceでは行わない。

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

実モデルはNova 2 Lite＋固定read Provider＋テスト保存先で、明示人数、構成訂正、仮定で更新しないこと、撤回を検証する。固定Providerの成功を実Providerや実ブラウザの成功とは扱わない。
