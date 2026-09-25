# ADR 0084: 権限とframeを保ったEffective Intentを一度だけ導出する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#634–#641、ADR 0074 / 0076 / 0083

## 背景

保存済みTrip/Conversation Request、会話で受理した差分、Profile由来の参考値、仮定上の条件を別々にモデルへ渡すだけでは、consumerごとに優先順位や撤回の扱いが分かれる。特に、従来のreducerはtargetとscopeだけを照合していたため、hypothetical frameの同じtargetがactual条件を置換・撤回できた。また「2番目」をモデルが生成したIDや現在のarray位置へ直接結び付けると、古い提示・別Tripへ誤適用できる。

## 決定

`compileEffectiveIntent`をpureな共有projectionとし、検証済みbase RequestとConversation semantic overlayから次を同時に導出する。

- persisted user/legacy/assumption条件
- Profile由来の`profileHints`（常にhintでありuser authorityへ昇格しない）
- actual conversation facts
- hypothetical facts
- retractionsと、それらにより抑止されたbase refs
- base/intent revisionを含む決定論的fingerprint

モデルContextではraw semantic overlayを重複送信せず、このprojectionを唯一の意味状態表示にする。保存Requestは引き続き正本であり、Effective Intentは読み取り専用の導出物である。Tool policy、public projection、UIも同じrevision/fingerprintを後続waveで共有する。

reducerの同一性は`frame + target + scope`とする。actualとhypotheticalは同じtargetでも別fact/tombstoneとして扱い、仮定の終了・撤回がactualを変更しない。

発言行為は操作と直交する`inform/correct/question/consider/reject/confirm/cancel/switch_topic`としてInterpreterから受け、Application検証後のreceiptへ記録する。Runtime repair文やAPI上の`user` roleはこのInterpreter入力へ渡さず、turn受付時のtrusted `userRequest`だけを引用根拠にする。

提示ordinalはモデルがIDを生成する操作にしない。モデルはboundedなordinalだけを提案し、Applicationがowner-scoped Working Stateの最新PresentationReceipt、version、Trip target、visible orderを検証して`candidate_ref`へ解決する。解決済みrefだけを保存し、modelが直接返した`candidate_ref`は拒否する。

相対日・相対weekday・月offsetはApplicationがturn固定のcalendar anchorで解決し、anchorとresolver versionを保存する。月精度を任意の日へ丸めない。モデルが返すexact dateは、現在user quoteに決定論的に確認できる場合だけ受理する。

## 却下した案

- Profile値をbaseと同じ強さでmergeする: 今回の明示条件や撤回を復活させる。
- frameをscopeだけで代用する: hypothetical/actualの衝突を防げず、条件の意味も失う。
- ordinalとcandidate IDをモデルに同時生成させる: source/owner/versionの自己申告を許す。
- 会話履歴・repair文をInterpreterへ再送して出所を推測する: trusted user turnとの境界が消える。
- 「来月」を月初や任意の日付へ変換する:利用者が述べていない精度を追加する。

## 影響

- Working State v2は未展開中のためreceipt/tombstoneへspeech act/frameを追加し、旧v1 readerは維持する。
- strict model schemaとApplication validatorの両方が新contractを検証する。Application-owned candidate refはprovider schemaへ公開しない。
- Effective Intentがbase条件を抑止してもTrip/Profile自体は変更しない。永続変更は既存Proposal、利用者confirmation、CASを通す。
- ordinalの対象がない、範囲外、別Trip、期限切れの場合は意味差分を受理せず限定確認へ進める。
