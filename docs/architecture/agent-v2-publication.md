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
各項目は`{ reference: { evidenceId, field }, value }`とし、モデルは`reference`をそのまま選択する。
概要・アクセスなどの見出しからfieldを作らせず、資料値と参照の組を明示する。
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

#781では既存のApplication admissionをZodの`superRefine`からも呼ぶ。最新のEffective Intentと、
初期Evidence・今回のreadを同じ上限でmergeした参照に対して検証する。存在しないfield等をSDK終了後に
初めて検出するのではなく、SDK標準のvalidation feedbackとして同一invoke内でモデルへ返す。
feedbackは閉じた拒否codeと選択方法だけであり、会話や生のEvidence、秘密値をエラーへ含めない。
独自の再invoke・補正・公開fallbackは追加せず、訂正できなければ既存上限で停止する。
最終公開時のEvidence/claim、receipt、currentness、衝突検証とA/B commitは省略しない。

実BedrockのConversation評価も本番と同じ4096累積出力token/Nova 2 reasoning lowを使う。
旧1024上限による途中終了を本番設定の評価と混同しない。6 cycles/2 reads/60秒の上限は維持する。
Conversation fixtureは本番の`explore_destination`を使い、discovery・ページ読込・地点照合を固定Providerで
組成する。mediaのみを渡して本番Promptの目的地調査が実行できないfixtureと混同しない。

## #781の原因確認（2026-10-03）

- 本番の失敗は検索2回とSDK終了の後の`v2:publication:invalid_field`である。選択したfieldは保存されておらず、
  不存在・禁止項目・値の型のいずれだったかを過去ログから確定できない。
- mainの実SDK構成へ同じscripted出力（不存在field・架空ID・禁止URL項目）を与えると、3ケースとも
  不正参照を持ったままSDKが終了する。修正後は同じ入力を標準feedbackで訂正し、readは1回のまま公開まで成功する。
- [実Bedrockの修正前後比較](https://github.com/ymho/transitforge/actions/runs/37105070543)では架空施設の2ケースは
  両方とも`sourceExcerpt`を選んで成功した。この測定では本番の不正field選択を再現できていない。
  同runのmedia-only Conversation fixtureは候補を得られず保存依頼が出力上限に達し、run全体は失敗した。
  fixtureのTool構成を本番へ合わせて再検証する。不成功runを後の成功で消さない。
- [目的地調査を組成した検証](https://github.com/ymho/transitforge/actions/runs/37105455049)では4ターンの
  完了・Trip条件の受理/訂正・未対応保存・replayが成立したが、候補カードのassertionが失敗した。
  固定Providerには公式ページ照合URLと鮮度期限が欠けていた。これらを補い、実モデル呼出し前に
  Tool結果→候補参照→公開カードまで成立する非課金テストを追加した。本番の公開制約は緩めない。
- [最終の実Bedrock検証](https://github.com/ymho/transitforge/actions/runs/37105876800)は5 tests成功。
  会話4ターン（行き先受理・訂正・カード・未対応保存・履歴/replay）と短い説明2ケースが完了し、
  固定Providerの公開テスト2ケースも成功した。実Provider・実ユーザーのブラウザでの再送は未実施である。
  比較用のbranch限定workflow変更は最終差分から除去し、既存main限定の手動評価へ戻した。

## 合否の区別

- 決定論的Acceptance: actual SDK + scripted model。構文拒否、不要な末尾呼出しなし、上限、A/B/history/replay、owner・Evidence拒否。
- `AGENT_V2_LIVE=true npm run test:agent:v2:conversation-live`: actual Bedrock + fixed travel Provider + state fixture。会話4 turnsと短い回答2 cases、最大6 model cycles/turn、各turnは60秒、productionへのwriteなし。
- 実Provider/実ブラウザ: 別の確認。上記の成功で代用しない。

#721のV2専用Frontend表示分離は別作業。今回の公開snapshotの保存契約は維持する。
