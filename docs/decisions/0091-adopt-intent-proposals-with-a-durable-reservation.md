# ADR 0091: 意味Proposalの採用をdurable reservationで直列化する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#640、#641、#642、#643、#647、#648、ADR 0054、ADR 0090

## 背景

検証済み意味差分をTrip Proposalへ結び付けても、採用時に古いintent revisionや別Conversationのbindingを検査しなければ、表示後の訂正を上書きできる。Trip tableとConversation Working Stateは別tableであり、Trip CAS成功後にWorking State更新が失敗する可能性もある。Tripを補償削除したり、同じdeltaを再適用したりしてはならない。

また「出発地を未定に戻す」のoverlay factを採用後に単純削除すると、UserProfileの普段の出発地が復活する。既存Profileデータの削除ではなく、そのTripだけの継承抑止を保存する必要がある。

## 決定

Trip mutationの前に、owner-scoped Working Stateへ`adoptionInFlight`をrevision CASで予約する。予約はProposalの完全な`intentBinding`、Trip/base revision、mutation IDを持つ。予約時に以下をすべて検証する。

- Conversation、Trip、base Trip revisionが現在のWorking Stateと一致する
- overlayのintent revisionとbindingが一致する
- pending Proposalのbindingと完全一致する
- change/group/action/target/scopeが保存済みのaccepted receiptに存在する

意味reducerは予約中の新規deltaを拒否する。Tripは既存mutation receipt/CASで一度だけ更新する。Trip commit後、同じ予約を使って消費対象のafter-fact/tombstoneだけをoverlayから除き、無関係なfactを保持し、採用receiptとcommitted Trip revisionをWorking Stateへ保存する。

Trip commit後のstate更新が失敗した場合、APIは成功と偽らず`unavailable`を返す。クライアントが同じmutation IDを再送すると、Trip mutation receiptをread-backし、残った予約からstate完了だけを冪等実行する。Tripを削除・巻き戻ししない。Trip commit前の失敗では予約を解放する。

明示unknownによるProfile継承抑止は`TripRequest.profileSuppressions`へversioned provenanceとして保存する。今回は意味を損なわず表現できる単一属性のoriginだけを自動投影し、粗いtarget単位で複数の興味や移動属性を一括抑止しない。

Trip API Lambdaにはserver-state tableの`GetItem`、`PutItem`、`TransactWriteItems`だけを追加する。Query/Delete/Scanや管理権限は与えない。

## 結果

- 古い・別Conversation・改変bindingはTrip更新前に拒否される。
- 採用したdeltaだけが消費され、同じturnの未対応party等はoverlayへ残る。
- 通信断やstate完了失敗後も同じmutation IDで回復でき、Tripは二重更新されない。
- Profile変更や継承抑止は既存Trip・予約を自動更新しない。予約保護と明示reviewは従来どおりTrip Applicationが担当する。
