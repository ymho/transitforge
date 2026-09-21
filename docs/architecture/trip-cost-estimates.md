# TripのAI費用概算（#458）

## 保存契約

Trip V2へoptionalな`costs`を追加した。既存Tripはfieldなしで読み、0円の予測を補完しない。
別Repository・LocalStorage・予算サービスは追加しない。

- `forecast`: Trip ID、生成根拠revision、生成日時、4項目の予測。
- `items[].category`: transport/accommodation/sightseeing/food。初期版はカテゴリを安定した項目IDとする。
  それぞれ交通・宿泊・観光・食事の旅行全体・利用者全員分。予定1件ずつの明細分割は行わない。
- `items[].amount?`: 既存Moneyの原通貨・safe integer最小単位。省略は未推定、0とは異なる。
  説明240文字、前提6件×240文字を保持する。4カテゴリの欠落・重複を拒否する。
- `overrides`: カテゴリごとのユーザー金額。存在すれば0でも表示額として採用し、元のAI値は残す。
- `stale`: Requestまたは採用済みitemsが変わるとDomainがtrueにする。タイトル・費用編集だけでは変えない。
  再予測のみfalseへ戻す。異なるrevisionの予測を古いTripへ適用できない。

`cost_forecast` patchは現在Trip ID/revisionと一致する予測のみ受け付け、既存overrideを引き継ぐ。
`cost_override` patchは1カテゴリの設定または解除。全解除は4件のpatchを1Proposalとして確認する。
合計は通貨別の計算値であり保存しない。未推定が残れば部分合計。為替換算と合計直接編集はない。
個々の額だけでなく合計のsafe integer上限も保存前に検証する。

## Server Agentと公開応答

認可済みTrip snapshotを取得したturnにのみ`propose_trip_costs`を登録する。
モデル入力は4項目のカテゴリ・概算・説明・前提だけ。Trip ID/revision/生成時刻はServerが決め、
override・合計・取得済み価格は入力できない。人数または日程が不明なら金額付き項目の前提を必須とする。
推定不能はamountを省略する。Tool失敗時に0円を生成せず、Tripも書き換えない。

公開`tripCostProposal`はcost_forecast patch 1件、12KiB以内。completed/follow_upだけに付与し、
本文・assistant message・receiptを同じtransactionで保存する。同一turnの再送は同じ案を返す。
通常のConversation appendから案を注入できない。SSEと履歴の読取でも公開契約を検証する。
条件案と費用案は同じturnに保持できるが、確認は別々。片方の採用でrevisionが変わった場合、
他方を自動rebaseせず再生成を求める。Trip未作成の相談には費用Toolを登録しない。

## UIと確認

現在のTrip workspaceへ費用セクションを接続した。#459の4タブ統合ではこのread modelを利用する。
「AIに概算を依頼」→差分比較→「確認して旅程を保存」で既存Server writer/CAS/read-backへ進む。
履歴は「費用の概算を確認」から開き、自動採用しない。
項目の編集・取消・AI値への復帰を提供し、全解除は確認を挟む。通貨別合計はread-only。
入力は文字削除で補正せず、負数・空欄・桁超過・通貨に合わない小数を拒否する。

同じTripの再取得中も未保存入力を保持するが、revision変更後は保存を拒否して再編集を求める。
別会話・アカウントへ入力を持ち越さない。費用編集中の画面移動・ページ離脱を確認する。
保存の応答喪失、CAS競合、遅着応答は既存mutation receiptとsourceのgeneration検証を使う。
更新結果はサーバから再読込し、別の画面でも同じ費用を取得できる。

## 価格事実との分離と検証

AI概算とユーザー編集は予約価格、支払済み、Offeringの観測価格、価格保証ではない。
費用patchは採用意思・予約・予定を変更せず、Feasibilityのcost factを生成しない。
hard budgetのunknownを概算でsatisfiedへ変更しない。旅行中の予定組替えpatchへ費用を混在させない。

Domainの合計/部分合計/0円/未定/原通貨/桁上限/stale/再予測保護、Server Tool境界、
生成→履歴→再送→認証済みTrip CAS→再読込、フォーム入力と明示確認をoffline testで検証する。
実Cognito/AWS/Bedrockでの費用schema・前提・対象維持・非断定のLive評価は未実施。
推定精度や実モデル品質をoffline fixtureだけで保証しない。#458はLive確認を含め完了扱いにしない。
