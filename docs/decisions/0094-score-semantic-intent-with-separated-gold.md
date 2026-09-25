# ADR 0094: 意味解釈を入力分離したgoldで採点する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#647、#648、#652、ADR 0027、ADR 0082、ADR 0083

## 背景

最終回答の文面やschema成功だけでは、発話がどの操作・target・modality・scopeとして解釈されたか、無関係な条件を変更したかを判定できない。expectedをmodel Contextへ混ぜるfixtureは意味理解を測定しない。また、有料評価を無制限に反復してはならない。

## 決定

公開development corpusの入力とgoldを別moduleに置く。入力はcase ID、発話、trusted calendar、category/tagだけを持ち、goldは許可される解釈集合と禁止targetを持つ。runnerはmodel応答を得た後にだけcase IDでgoldを結合する。

初期corpusは重複しない120発話を、明示場所、精度、modality、撤回、仮定、質問、相対日付、日別scope、予算basis、代替追加、未知状態に分ける。scorerは許可解釈への一致と禁止変更を別々に報告し、途中のexecution failureを成功へ足さない。

Live runnerは反復前にcase数、model call、input/output token、推計USD上限を固定する。token単価は環境から明示し、未知のまま有料実行しない。各caseは全反復成功したときだけstable successとする。

## 帰結

- Promptやruntimeはgoldを参照できず、case ID・地名分岐を追加する理由にならない。
- 有限corpusのzero violationは自然言語全体の無欠陥保証ではない。
- この120件はsingle-turn意味層であり、30本のmulti-turn、20故障境界、production Server、実Browserは別の層として結果を区別する。
- held-out corpusは公開Prompt例と分離し、リポジトリへ秘密値や実利用者データを追加しない。
