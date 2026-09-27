# Agent v2: 自由な対話と受理条件の表示

Related: #736 / #734 / #721。

conversation / clarification / uncertaintyは任意のtext（1〜600文字）で、確認・補足・仮定・不確実性を説明できる。
SDK structured outputのまま公開し、lastMessageの抜取り、外側repair、独自loopや発話regexは追加しない。
自由文はEvidenceや操作の権限ではない。answer/candidatesの実在Evidence、operation_resultの同一実行receipt照合は維持する。
自然文の意味の完全な正しさはスキーマだけで証明しない。外部事実や操作成功を作らないことはモデルの品質としても検証する。

Applicationが実Controllerの受理記録と現在のEffectiveIntentをoperation IDで照合し、「今回の相談条件（反映済み）」を表示する。
受理記録なし・拒否・失効した旧receiptから成功表示を作らない。表示は現在値だけで、内部ID・来歴quote・Profile推測を含めない。
最終16KB上限と既存B commitを通り、SSE/history/replay共通になる。Trip保存や予約の成功を意味しない。
既知の条件でも文脈付きの確認質問は可能とし、固定の同じ値を聞く質問だけを従来通り拒否する。

## SDK標準の会話履歴

通常の認証済みConversation組成・owner-scopedの履歴loaderで取得した公開user/assistant本文だけを、
Strandsの`AgentConfig.messages`へ渡す。履歴をJSON内の参考データとして重複して埋め込まない。
現在のuserMessageとApplication状態の入力は分離したまま、結合前の全データに従来24kの上限とprivate field除去を適用する。
raw Tool結果・内部思考・system roleを会話履歴から作らず、不正なrole/textを拒否する。
元のConversationが保存の正本であり、SDK sessionや別の会話保存先を作らない。

JSONに履歴を埋め込んだ旧試験run 36298787600では自由文は全18ターンで返ったが、
『大阪です』を出発地ではなく行き先として受理するため3反復とも失敗した。発言・期待する保存値は変更せず、
SDK標準履歴へ移した同じ6ターンを再検証する。決定論的テストでは実SDKへ渡ったroleと順序も確認する。

## 出力上限と検証

maxOutputTokens（モデル1回）とmaxInvocationOutputTokens（累積実行）を分け、本番は4096/4096を明示して従来上限を維持する。
人数指定→『大阪です』→人数what-if→実際の訂正→出発地撤回→お礼という会話で、保存値と受理表示、
what-ifのwriter callback0、無関係な条件の維持、B replayと履歴の一致を検証する。
`AGENT_V2_LIVE=true MODEL_ID=jp.amazon.nova-2-lite-v1:0 npm run test:agent:v2:free-dialogue-live`は実モデルの6ターン。
各最大6 calls・60秒、model出力1536、累積4096。通常CIでは課金liveを実行しない。

#729の匿名cohort/参加scope writerはこの先行sliceに含めない。#734での同一what-if再現は自由文対応後3/3完了したが、
対象が未定なのにcohortを更新する試験は3/3失敗した（run 36297796327）。短い対象補足・逆訂正後の保存値は成功したものの、
これを全体成功とは扱わず、#734/#736の課題として残す。推論設定比較run 36298032840も完走せず、本番の推論設定は変えない。
自由文の先行反映でこの未解決のwriterを公開しない。
