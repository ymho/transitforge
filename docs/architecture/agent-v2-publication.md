# Agent v2 公開契約

#703 の第2段階。旧 Context serializer と旧回答レンダラーを使わず、Strands の通常の Tool loop で提出した回答案を Application が検証する。

## 所有権

モデルは `submit_reply` に種類と参照を提出する。この Tool はDBを書かず、外部操作もしない。提出内容は各invokeだけの不変な回答案で、Conversationの第二正本ではない。

公開の正本は `agent-v2-publication.ts` の受理結果。SDKの最後の自由文、思考ブロック、`toString()`は公開にも会話履歴にも使わない。提出後の追加Domain Toolも実行しない。外部Toolの予算と回答提出を混同しない。

## 現段階の種類

- answer: 実在するEvidence IDとfactsのfieldを選ぶ。表示する値・Claim binding・出典はApplicationが構成する。IDを付けただけのモデル自由文は受理しない。
- conversation: 挨拶・お礼・受領を表す限定キー。Evidenceは不要。
- clarification: 未受理の条件についての基本的な質問。受理済みの同じ条件は再質問しない。
- unavailable: read-only経路では保存・変更・予約・決済を実行できないと明示する。実行予定や成功の約束へは変換しない。
- operation_result: 同じexecutionの成功receiptだけを表示する。receiptはApplication専用引数で、モデルのschemaには含めない。現Strands compositionはreceiptを渡さないためこの種類は受理されない。
- uncertainty: 情報が未確認であることを明示する。根拠なしの事実説明として扱わない。

事実参照では欠損・衝突・失効・不適用・保持禁止・古いintent依存・秘密fieldを拒否する。Claimのstatementは実際の表示値から構成し、共有Evidence validatorでも検証する。sourceExcerptは引用であり、現在の営業や予約可能性の追加保証ではない。

## 自然文との境界と未完了

これは安全な公開契約の最初の小さい文法であり、自由な雑談、任意の根拠付き言い換え、旅行案・比較表の完成仕様ではない。モデルが新しい事実を混ぜた文章へ単にEvidence IDを付けても、その文章の真実性が証明されるわけではないため、今回は任意の説明文を導入しない。

短い会話と不足条件確認は通るが、自由な旅行説明・推薦・旅程カードは後続の製品品質評価で拡張する。既存V1レンダラーをコピーしたり、全応答を恒久的に定型文へ置換したりする完了宣言はしない。

## テストと評価

pureな公開契約の負例、実Strands Tool loop、Conversation保存/replay、専用Acceptance CIを使う。旧Promptの文章やrepair回数は期待しない。

Live評価は語尾辞書ではなく、Applicationが受理した種類、選択したfield、操作状態を検査する。流暢でも未受理の文章は成功にしない。別の安全な種類で話をそらした応答もtask completionにしない。失敗時に測れていないusageはnullとし、0 call/0費用とは報告しない。

2ケースのLive Smokeは公開経路の評価に限られ、汎用旅行相談の品質や本番切替の根拠にはしない。CI成功と実モデル品質は別に報告する。

## ロールアウト

V2はdefault-off。IAM、DB、保存契約、V1 defaultを変更しない。実際の保存・予約・決済Toolは接続しない。#703/#681はLive品質・残る成果物の受入を確認するまでcloseしない。
