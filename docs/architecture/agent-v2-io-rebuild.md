# Agent v2 入出力の再構築

関連: #681 / #703。基準commit: `6ddd8e6ce7390945d4af6c96c312e0e4b41a9401`。

## 今回切り離したもの

V2の入力を`strands-turn-input.ts`のデータ専用投影へ置き換える。
`agentDecisionContextText`と`buildAgentDecisionContext`はV2実行経路から呼ばない。
生の発言は`userMessage`として保持する。基準日は`application.clock`、受理済み条件は
`application.effectiveIntent`、保存済み計画は`application.state`に分ける。
過去のruntime指示・判断要約・raw Profile・working state receiptはモデルへ再注入しない。
Profileの使用許諾と優先順位はApplicationで解決したEffective Intentだけから受け取る。

型の移行接続としてServerAgentRuntimeInputは引き続き利用する。ただし旧Contextの実行時
serializerは使わない。この投影は一回の実行だけに使い、DBや別Memoryへ保存しない。
権限確認、CAS、A/B commit、Toolの決定論計算は変更しない。

条件と発言の全文を黙って切り詰めない。文字数・構造の予算を超えたら明示的に失敗する。
Applicationデータの秘密値・owner・座標は追加で除外するが、これはowner確認やProfile
許諾の代わりではない。既存loaderが返すprivacy-filtered projectionを前提とする。

## 回答候補は公開回答ではない

SDKの`AgentResult.toString()`は使わない。assistantのtextBlockだけを回答候補として抽出し、
reasoningBlock/signatureは含めない。Tool/citation/interruptは別の明示的な変換が必要であり、
汎用文字列化へfallbackしない。普通のtextに思考用マークアップが混在していた場合も、
一部を除去して合格扱いせず候補全体を拒否する。

この抽出は自然言語の正確さ、保存の権限、Evidenceとの意味的整合性を保証しない。

旧実装の「Evidenceなしなら自由文をfull/completedで公開する」経路は閉じる。
Evidenceなしの会話・確認質問・未対応操作の応答は、V2公開契約へ接続されるまでfailed/degradedとし、
本文は公開しない。この一時的な制限を最終仕様や会話品質の改善と呼ばない。

## まだ残るもの（完了とみなさない）

- Evidenceありの表示には暫定的に既存`presentGroundedEvidence`を使用している。
- この旧表示bridgeを廃止し、説明・根拠参照・確認質問・未対応操作・実行receiptを分ける公開契約が必要。
- 正当な雑談・確認質問までEvidence必須にする設計にはしない。
- 現行の保存文言検出は意味を検証する採点ではない。実行約束や基準日の取り違えも扱う評価へ置き換える。
- Live Evalのerror時usage集計、実モデルの会話品質、UIへの公開結果は別途実測する。

本番のV2 gateはOFFのまま。旧rendererの残存と未接続の公開能力があるため、このPRの
CI成功だけで#703/#681をcloseせず、Live Eval合格や本番切替とも扱わない。

## テスト方針

engine/runtimeのテストを入力・公開・副作用の境界から書き直す。V1のrepair回数やPrompt本文を正解にしない。
新入力のJSON、条件の非破壊保持、clock分離、未許諾Profileの非送信、思考混入の拒否、
no-evidence自由文の非公開を検査する。既存owner/CAS/replay/Evidence/Tool予算の検査は弱めない。

ローカルでは新しい純粋関数をTypeScriptから変換してNodeの16件の境界テストを実行する。
全リポジトリの型検査・SDK統合・build・V2 AcceptanceはGitHub CIで検証する。
