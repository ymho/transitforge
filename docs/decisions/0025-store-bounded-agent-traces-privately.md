# ADR 0025: boundedなAgent Traceを非公開S3へ短期保存する

- ステータス: Accepted
- 日付: 2026-08-25

## 背景

Structured Agent Traceをメモリだけに保持すると オフライン評価や利用者から報告された
不具合の原因をAPI request IDと対応付けて調査できない
一方で会話やTool payloadを無制限に保存すると個人情報 秘密値 保存費用のリスクが増える

既に明示的な会話フィードバック用の非公開S3があり パブリックアクセス遮断と
Lambdaだけの書込経路を備えている

## 決定

同じ非公開S3の`agent-traces/` prefixへ、実行全体を表す`agent-trace-submission-v1`と
モデル呼び出し単位の`agent-model-call-trace-v1`を保存する
新しいS3バケットは作らない

- 実行Traceはevent 100件 本文24KiBまでとし task ID execution ID API request IDを保存する
- 各モデル呼び出しの直前にクライアントが`modelCallId`を発行し、実行Traceの
  `model_started` `model_completed` `model_failed`と対応付ける
- LambdaがBedrockへ渡す最終的なmodel ID System Prompt message Tool定義 inference設定を
  `agent-model-call-trace-v1`へ保存する。成功時はstop reason token latency、失敗時は
  例外名 message HTTP status Provider request ID retryableを保存する
- モデル呼び出しTraceは1件3MiBまでとし、超過時はbyte数とSHA-256だけを保存する
- event schema field型 順序と`modelCallId`をLambdaで再検証する
- 秘密値 Authorization cookieと現在地座標を保存直前に除去する
- S3 server-side encryptionを明示
- `agent-traces/`は30日 `conversation-feedback/`は90日で削除
- IAMのPutObject権限を2つのprefixだけへ限定
- CloudWatchの保存ログはID 件数 durationだけとしpayloadを含めない
- モデル呼び出しTraceの保存失敗はログへIDだけを残し、案内の成功または元の失敗を上書きしない

## 影響

- request IDとtask IDから実行過程を短期間追跡できる
- 500を含むモデル呼び出し失敗でも、Bedrockが検証した実際の入力とProvider診断を確認できる
- System Prompt 会話 Profile Tool結果などの入力本文を短期間保持するため、非公開化
  server-side encryption サニタイズ 3MiB上限 30日削除を一体の境界として維持する必要がある
- モデル呼び出しごとにS3 PutObjectの待ち時間と保存費用が加わる
- 既存バケットを再利用するため追加のバケット費用とresource移行がない
- Traceの長期分析やIssue自動生成は別の仕組みが必要になる
- 実行Traceのサイズ超過 schema違反 保存失敗はTraceを欠落させるが通常のAgent回答とは分離できる

## 確認

- 正常保存 schema拒否 サイズ超過 S3失敗をテストすること
- 保存Bodyへ秘密値や現在地座標、構造化ログへモデル入出力を含めないこと
- モデル呼び出し失敗と保存失敗のどちらでも元のAgent結果を変えないこと
- lifecycleとIAMがprefix単位になっていること
