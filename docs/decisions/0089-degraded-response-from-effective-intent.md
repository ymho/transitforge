# ADR 0089: 縮退応答はEffective Intentと検証済みEvidenceだけから作る

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#640、#644、#645、#653、ADR 0088

## 背景

Providerが最終schemaを返せない場合、旧`verifiedPlanningSummary`は現在の`userRequest`へ「明日」regexを再適用し、`recoverPlanningDraft`は地名の文字列一致と固定の「日程・出発地が未定」「無理のないペース」を使っていた。これは通常の意味受理経路と別の解釈器であり、訂正済み条件、明後日・月offset、scope、許容度を失う。またtransport完了だけを見ると縮退回答を通常成功として数えてしまう。

## 決定

縮退presenterは現在発言を受け取らない。入力はApplicationがcompileした`EffectiveIntent`と、意味revision/依存targetでfilter済みの検証済みEvidenceだけにする。出発日はactual conversation factまたは保存Requestの単一exact dateだけを使い、曖昧rangeを日へ丸めない。Evidence候補はgrounding/presentation scoreで選び、発言中の地名regexでは選ばない。

固定の出発地未定、日数未定、pace、休憩、移動・宿泊・費用の捏造を削除する。確認済みsourceに対応するunscheduled activityだけを提示し、確認できていない範囲をcoverage/unknownとして表示する。安全なEvidenceがなければ架空候補を作らず、既存のfailure/limit応答へ戻す。

Runtime resultへtransport statusと独立した`delivery.status`（`full | partial | degraded`）と`basis`（`model | verified_projection`）を追加する。縮退presenterは`degraded/verified_projection`を付ける。Turn result、Dynamo history、SSE、Frontendの共通projectionで保存・strict parseし、UIは「確認済み情報だけ」と明示する。旧recordのfield欠落はread互換として許可する。

## 結果

- 「明日」専用分岐なしで、Applicationが解決した明日・明後日・相対weekday等を同じlocal dateとして扱える。
- A後の回答障害で受理済み条件を保持しつつ、未検証情報を補完しない。
- HTTP/SSE成功と回答品質を別に評価できる。
- Profile/Trip/予約の保存完了は引き続き別receiptが必要で、縮退応答から昇格しない。
