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

同じ非公開S3の`agent-traces/` prefixへ`agent-trace-submission-v1`を保存する
新しいS3バケットは作らない

- eventは100件 本文は24KiBまで
- task ID execution ID API request IDを保存
- event schema field型 順序をLambdaで再検証
- 秘密値 Authorization cookieと現在地座標を保存直前にも除去
- S3 server-side encryptionを明示
- `agent-traces/`は30日 `conversation-feedback/`は90日で削除
- IAMのPutObject権限を2つのprefixだけへ限定
- 保存ログはID 件数 durationだけとしpayloadを含めない

## 影響

- request IDとtask IDから実行過程を短期間追跡できる
- 既存バケットを再利用するため追加のバケット費用とresource移行がない
- Traceの長期分析やIssue自動生成は別の仕組みが必要になる
- サイズ超過 schema違反 保存失敗はTraceを欠落させるが通常のAgent回答とは分離できる

## 確認

- 正常保存 schema拒否 サイズ超過 S3失敗をテストすること
- 保存Bodyと構造化ログへ秘密値や現在地座標を含めないこと
- lifecycleとIAMがprefix単位になっていること
