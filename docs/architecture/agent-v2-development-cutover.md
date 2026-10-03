# Agent v2 開発用実環境切替

2026-09-26、#706で利用者が未対応機能・回答品質低下を許容してV2の実環境試用を承認した。
一般公開の品質合格でも、#703/#681の完了でもない。通常画面でV2の問題を観測し、V1との混在を避けるための切替である。

## 設定の正本と反映

現在の実サービスは `CD / Deploy` の `dev` environment がデプロイする。
同WorkflowがTerraformへ渡す次の値を実環境の選択とする。

- `TF_VAR_agent_runtime_v2_enabled: "true"`
- `TF_VAR_conversation_semantic_kernel_enabled: "false"`
- `TF_VAR_bedrock_model_id: "jp.anthropic.claude-sonnet-4-6"`（#785の実モデル回帰で選択）

Terraformの再利用可能なフラグ既定値はfalse、モデル既定値はNova 2のままにする。CD以外からdevへapplyする場合も、必ずこの明示設定と一致させる。
AWSコンソールだけでフラグを変えない。次回CDに上書きされる変更を正本にしない。
`mode=plan` は従来どおりapplyしない。通常CIと既存の破壊的変更チェックは弱めない。

apply後、Terraformが出力した既存Agent Lambdaに対してAWSの設定を読み戻す。
`State=Active`、`LastUpdateStatus=Successful`、実フラグとMODEL_IDがCDの期待値に一致した場合だけ
`Agent runtime verified: v2=true; semantic=false; state=Active; update=Successful; model=jp.anthropic.claude-sonnet-4-6.` を記録する。
関数の全環境変数、Secret、会話内容は出力しない。設定検証はモデル応答の品質検証ではない。

## 維持する境界

V2から公開する業務Toolはread-onlyのまま。回答提出 `SDK structured output` はDB更新Toolではない。
旧Semantic Intentの実モデルgateを同時に有効化しない。
認証、owner、CAS、Trip/Profile/Conversation正本、既存画面の手動保存API、認証・状態操作のIAMと実行回数/token/時間の上限は変更しない。モデル呼出しIAMは既存の選択モデル連動を使う。
モデル料金は同一ではなく、Sonnetの推論tokenも出力課金へ含まれる。実行上限を料金据置きの保証とは扱わない。
V2が失敗してもV1の回答へ自動フォールバックしない。利用不能と機能不足を混同せず、実際の失敗を記録する。

## 既知の未完了

自然な根拠付き説明・比較・推薦、複数ターンの意味解釈、旅行案・写真・保存のV2接続は開発途中である。
#705の限定された回答文法を最終製品とみなさない。CI greenを実モデル合格に読み替えない。
旧会話の完了済みturnを再送すると保存済み回答がreplayされるため、V2の初回確認は新しい会話・新しいturnを使う。

## 最初に記録する実環境確認

1. 確認済み情報の依頼でToolから回答・表示まで到達するか。
2. 保存能力がない操作を成功・実行予定として主張しないか。
3. 回答の履歴保存と再読込が成立するか。

実行したcommit、UTC時刻、request/execution ID、成功/失敗、未対応内容を区別してIssueへ記録する。
公開Issueへ本物の会話、Profile、個人情報、内部思考を貼り付けない。
CDの直近2時間診断には切替前V1も含まれるため、集計全体をV2の品質と判定しない。

## 復帰

重大な権限違反、データ破損、秘密情報露出、制御不能な課金・連続呼出し、利用不能は停止・修正対象とする。
V2を維持してモデルだけ戻す場合は、CDのモデルIDを`jp.amazon.nova-2-lite-v1:0`へ戻すPRを作る。
V1へ緊急復帰する場合は `.github/workflows/cd.yml` のV2フラグを `"false"`、モデルIDを旧実環境のNova 2へ戻すPRを作る。
どちらも設定期待値のテストを更新し、成功した設定の読み戻しと対象フローの結果を別々に確認する。
Novaへ戻すだけで#785の相談フローが安定するとは扱わない。
通常CIとCDを通し、同じ検証で `v2=false; semantic=false` を確認する。
旧SHAのRe-run jobs、Git全体の巻戻し、DBや会話履歴の削除は復帰手順にしない。
フラグの復帰は履歴の巻戻しではない。V1はその間の明示的な緊急復帰用で、追加改良や自動fallbackの対象ではない。

## 続く順序

最小実モデル縦断 → 自然な説明・比較・推薦 → 複数ターンと条件変更 → 旅行Tool/画面 → 提案・採用・保存 → 最終検証とV1撤去。
V1のPrompt、renderer、repair、内部テストを互換要件にしない。

関連: #681 #703 #706 / ADR 0096
