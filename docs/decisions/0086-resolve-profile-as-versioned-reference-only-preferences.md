# ADR 0086: Profileをversion付きreference-onlyの普段の好みとして解決する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#634、#640、#641、#642、#647、#648、#658、#659、ADR 0084

## 背景

UserProfileと保存済みTripRequest、会話意味差分を別々にmodelへ渡すと、どれを今回条件にするかがLLM判断になり、Profile由来の人数や予算が明示条件へ昇格したり、会話で未定へ戻した出発地が復活したりする。従来のProfile snapshotは興味を先頭6件へ絞り、数値許容度を3段階へ丸め、許諾済みメモを240文字へ切っていた。一方、既存Profile v2の項目を物理削除すると、利用者データを不可逆に失う。

## 決定

UserProfile v2の永続化形式は今回破壊しない。ApplicationがUserProfile本体とrepository revisionを`compileEffectiveIntent`へ入力し、普段の出発地、興味、pace、移動上の好み、許諾済みの宿泊・食事・避けたいことだけを`profileHints`へ投影する。hintは`source.kind=user_profile`、profile version/revision、元path、`reference_only`適用状態、soft strengthを別軸で保持する。

普段の人数・同行者・子どもの年代、基準の曖昧な予算メモ・移動上限、未接続のnoveltyは新しいAI入力と設定UIから外す。既存値はDynamoDBのProfile v2内に保持し、更新時にも未表示fieldを消さない。`ignoredProfileSettings`には値ではなくpathと理由だけを記録する。AI利用OFFのメモ本文はhint、model context、traceへ出さない。

保存Request、会話actual fact、Profile hintはtargetだけで一括上書きしない。scopeが限定された会話条件は同じscopeだけへ作用する。experienceはpreference/正規化text属性を照合し、食事の追加で自然や歴史を消さない。globalなunknown/retractは該当条件の継承を抑止し、出発地を未定へ戻した後にProfile起点を復活させない。

modelへ渡す`travelProfile`互換projectionも解決済み`profileHints`から導出する。これによりraw UserProfileを第二の優先順位判断材料として並列送信しない。興味は固定件数で切らず、数値は丸めず、許諾済みメモはProfile validatorの上限内で全文を保持する。Profileは初期提案・比較の参考であり、Tool必須入力、TripRequest、予約、利用者明示条件へ自動昇格しない。

## 移行と保持

- storage schema/versionはv2のまま。破壊的migrationや一括rewriteを行わない。
- 廃止UI項目の既存値はread/write round-tripで保持するが、新しいAI projectionでは参照しない。
- 将来の明示的なデータ整理・export/deleteではProfile全体の既存管理契約に従う。
- Profile変更は既存Trip/予約を更新しない。次の相談で新しいprofile revisionを読み、Effective Intentを再導出する。

## 結果

- AI、Tool policy、条件表示が同じrevision付きEffective Intentを参照できる。
- 情報損失とProfileの無断昇格を同時に防げる。
- UIは毎旅行の大フォームではなく、任意の普段の好みに縮小できる。
