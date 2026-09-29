# Agent v2の構造化出力と公開境界

関連: #716、#631、ADR 0096。対象SDK: @strands-agents/sdk 1.18.0。

```text
userMessage → Strands Agent
  → 必要ならupdate_intent / A commit
  → read Tool / Evidence
  → SDK structuredOutputSchemaで構文検証・終了
  → result.structuredOutput.reply
  → Application admission / Evidence・claim検証
  → B commit → SSE / history / replay
```

## 標準機能に委ねること

Zodのstrictなdiscriminated unionを構文の唯一の定義にする。SDKへ渡すJSON SchemaとApplicationのparseは同じZod schemaから生成する。SDK Toolの最上位はobjectで、variantはreplyの中へ置く。独自のflat schema、手書きvariant parser、submit_reply Tool、提出済み状態、Model Proxy、toolChoice切替は使わない。

SDKは有効なstructured outputを取得した時点で終了する。回答取得後に終了用のmodel callを追加しない。通常のlastMessage、toString、reasoning、SDKのplain textは公開も保存もしない。

## 検証の責務

Schemaの通過は事実の正しさや保存の権限を証明しない。Evidence参照の存在・一意性・currentness、Effective Intentのrevision/fingerprint、操作receipt、owner、CASはApplication側に残す。モデルがschemaに沿った架空IDを返しても公開しない。

#758の実Provider検証で確認した衝突を避けるため、Web discoveryのhit IDは問い合わせと情報源を含める。
検索内の順位（`web-1`等）を複数facetで共有するIDとして使わない。Discovery Evidenceは実行・Tool呼出し単位の
観測として識別し、再検索や次の相談で取得時刻が変わっても以前の観測と混同しない。複合Toolが返す
読了ページと地点照合は、同じProvider参照を含んでも別の投影として識別する。
同一観測の再投入は冪等とし、本当に同じEvidence IDへ異なる内容を割り当てた場合の公開拒否は維持する。

## 調査結果と回答の完了

`replyReferences`は公開時と同じEvidence/currentness・Intent・表示可能な値の検証を通した参照だけを返す。
未検証の検索snippetを回答用根拠として提示しない。公開時の再検証は省略しない。
`explore_destination` / `discover_destinations`のモデル向け結果はoutcome（部分失敗の範囲を含む）と
回答・カード用参照へ絞る。内部のdiscovery batch、取得ページ、地点照合、assessmentは重複して渡さず、
元のTool結果とEvidenceはApplicationに保持する。他のToolの出力は変更しない。

日程未定でも利用者自身の行き先の希望を受理できる。未指定をclearとして扱わず、写真等が不足するpartialは
確認できた情報で回答し、不足を説明できる。固定Tool順・発話別分類・強制回答・独自の反復抑止は追加しない。

本番compositionが、検証した`jp.amazon.nova-2-lite-v1:0`へNovaの`reasoningConfig`をlowで指定する。
Engineの既定は推論設定を追加しない。小さい独立fixtureと本番設定を分け、日程liveは両構成で検証する。
他のModel IDへNova固有パラメータを送らない。モデルの回数・累積出力・実行時間の上限は変更しない。
推論tokenも出力課金と累積出力上限に含まれ、内部reasoningは公開・保存しない。
参考: [AWS Nova 2 extended thinking](https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html)。

## 短い説明・話題別表示・相談の継続

`answer`は根拠となる`references`と、短い`commentary`または`sections`（見出しと本文、最大4節）を提出できる。
説明がある場合、参照したWeb本文をその後へ連結せず、Applicationが検証した出典リンクだけをまとめる。
説明のない直接引用でも`sourceExcerpt`は最大160文字とし、資料本文を大量表示しない。
説明と各節は選択したEvidenceへのbindingを持ち、生成された事実を検証済みの資料値とは扱わない。
見出しはモデルが内容から選ぶ。固定の分類器や必須の「概要・イベント・アクセス」テンプレートにはしない。
イベントの過去/将来と未確認を区別する方針もモデルへ渡すが、Schema成功を事実性の証明にはしない。

`answer`/`candidates`の`nextQuestion`で、情報提供と次の確認を同じターンに含められる。
モデルは既知条件・利用者の関心から質問を1つ選ぶ。固定の質問順や未設定項目の一括聴取は行わない。
見出し・本文・質問中のHTML/Markdownはエスケープし、見出しの構造だけをApplicationが付ける。

Frontendはcurrentな回答を表示した後、actualな条件の受理receiptがあればTripをServerから再取得する。
回答の表示前やSSE受信中にrevisionを更新して、自分の応答をstaleとして破棄しない。receiptの値をBrowserで
Tripへ転記しない。履歴再表示・別会話の遅延応答・拒否のみのreceiptでは再取得しない。再取得失敗時は既存の
unavailable表示とし、古い条件を最新情報として残さない。

## SDKの再試行を隠さない

SDK 1.18.0は不正な構造化出力にvalidation feedbackを返す。plain textで終了しようとした場合は、SDKが構造化出力Toolを一度指定して再度modelへ要求し、それでも拒否すればStructuredOutputErrorとなる。これは追加の自前repairではなく、選択したSDKの標準動作である。

すべて同一invokeのturn/token/deadline上限内で行い、外側でinvokeを再実行しない。不正出力の繰返し、指定後の拒否、token上限、通信失敗を完了と扱わない。Domain Tool budgetにはSDKの出力Toolを数えない。

## 合否の区別

- 決定論的Acceptance: actual SDK + scripted model。構文拒否、不要な末尾呼出しなし、上限、A/B/history/replay、owner・Evidence拒否。
- `AGENT_V2_LIVE=true npm run test:agent:v2:conversation-live`: actual Bedrock + fixed travel Provider + state fixture。会話4 turnsと短い回答2 cases、最大6 model cycles/turn、各turnは60秒、productionへのwriteなし。
- 実Provider/実ブラウザ: 別の確認。上記の成功で代用しない。

#721のV2専用Frontend表示分離は別作業。今回の公開snapshotの保存契約は維持する。
