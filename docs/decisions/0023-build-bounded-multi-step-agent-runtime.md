# ADR 0023: boundedなMulti-step Agent Runtimeを段階導入する

- ステータス: Accepted
- 日付: 2026-08-25

## 背景

既存コンシェルジュの処理はBedrockのTool loopと画面操作を大きなフローで扱う
Domain Tool Evidence Provider Adapter Traceが共通化された後も loopを一括置換すると
鉄道案内 旅行相談 画面操作を同時に回帰させる危険がある

一方でAgentが複数のDomain Toolを組み合わせ 情報不足や実行上限を認識するには
Provider非依存のオーケストレーション境界が必要になる

## 決定

`src/application/agent`へ次の責務を分けた最小Runtimeを置く

- `problem-framing`: 利用者の目的 意図 制約 不足情報
- `agent-planner`: 利用可能なToolに基づく実行方針
- `tool-registry`と`agent-tool-executor`: 入力検証 順序実行 timeout
- `tool-evidence-registry`: Tool結果からEvidenceへの変換
- `runtime-policies`: 反復 model call Tool 実行時間 Evidenceの上限
- `agent-response-generator`: follow-up 最終応答 失敗時応答
- `agent-runtime`: 上記を接続するProvider非依存loop

後続のADR 0044でBedrockを意思決定の正本にした後 `problem-framing`と`agent-planner`は
中継だけになったため削除した。現在は構造化Context BuilderとBedrock Tool Useがこれらの責務を
置き換え bounded loop Evidence Policy Traceの決定は維持する。

Tool結果はassistantのTool call IDと対応するuserのTool resultとして次のmodel callへ返す
Toolは同じAgent実行内で順序付きに実行し EvidenceはID重複を除いて上限件数まで保持する
Provider失敗 max token timeout 契約にないTool callを成功応答として扱わない

同一実行内でTool名と正規化した入力が一致する呼び出しは再実行しない。成功済み入力の
再要求は重複エラーとしてモデルへ返し、確認済み結果から最終回答させる。再試行不可エラーの
重複は同じ結果を再利用して既存のTool除外ポリシーへ渡すため、外部APIを無意味に再実行しない。

通常の再計画枠を使い切る直前は、最後のmodel callからToolを外して最終回答フェーズにする。
モデルは収集済みEvidenceだけを根拠に、分かる範囲と不足情報、次に可能な行動を説明する。
この回復処理でもEvidence validationとmodel call、Tool call、実行時間の上限は緩和しない。

新Runtimeの有効化は`AgentRuntimeRolloutRouter`で機能単位に行う
未指定の機能は既存loopへ渡し 現段階では`src/main.ts`を一括置換しない

## 影響

- 固定応答Providerと小さなToolでloop全体を決定的にテストできる
- 新旧Runtimeが一時的に併存する
- 実際の機能を移行するにはDomain ToolとEvidence mapperの構成が必要になる
- Reflection Multi-Agent MCPはこのRuntimeへ含めず評価結果を見て後から判断する

## 確認

- 2つ以上のToolを順序どおり実行して結果をmodelへ返せること
- model call Tool call 反復 実行時間 Evidenceの各上限で停止すること
- 同じTool入力を再実行せず 上限直前に確認済み情報から回答へ着地できること
- 不足情報はToolを呼ばずfollow-upになること
- 機能単位で新旧handlerを切り替えられること
