# Agent v2 実環境運用と復旧

2026-09-26の#706で開発用実環境をv2へ切り替えた。#790（#788対応）でBackendのv1実行エンジンを撤去済み。
一般公開の品質合格や#758/#751の横断検証完了を意味しない。画面の旧表示型も#791（#721対応）で撤去済み。

## 設定の正本と読み戻し

実サービスは`CD / Deploy`の`dev` environmentがデプロイする。Agent Lambdaは常にStrands v2を組成する。
Terraformは`AGENT_RUNTIME=strands-v2`を設定する。これはデプロイ識別子であり、別Runtimeの選択フラグではない。
`AGENT_RUNTIME_V2_ENABLED`、`SEMANTIC_INTENT_ENABLED`と対応するTerraform変数は削除した。
CDの`TF_VAR_bedrock_model_id`は引き続き`jp.anthropic.claude-sonnet-4-6`を明示する。
Terraformの再利用可能なモデル既定値はNova 2のままなので、CD以外からdevへapplyする場合も明示設定を一致させる。
`mode=plan`はapplyしない。AWSコンソールだけの変更を正本にしない。

apply後、Terraformの出力するAgent Lambdaから必要な設定だけを読み戻す。
`tools/deployment/verify-agent-runtime.mjs`はState=Active、LastUpdateStatus=Successful、
runtime=strands-v2、旧フラグ2個が不在、MODEL_IDがCD期待値と一致することを要求する。
関数の全環境変数・Secret・会話内容は出力しない。成功表示は
`Agent runtime verified: runtime=strands-v2; legacy-flags=removed; state=Active; update=Successful; model=jp.anthropic.claude-sonnet-4-6.`
となる。設定の検証とモデル応答の品質検証は分ける。

## 維持する境界と検証

認証principal、owner、CAS、Trip/Profile/Conversation正本、Tool/Evidence検証、turn再送の冪等性と実行上限は保持する。
条件反映と候補採用はApplicationの検証・mutation receiptを経由する。SDKやモデルは保存結果を自己申告できない。
v2が失敗しても旧Runtimeへ自動で切り替えない。地点詳細のBedrock要約は別用途として残す。

旧`Agent Eval / Model Comparison`と`Agent Eval / Semantic Intent Live`は撤去した。
通常CI、v2 acceptance、Strands v2 Live、保存済みObservationを採点するSmoke/Full、診断Actionsは保持する。
旧の20件fault catalogは撤去し、現行の受入根拠は`agent-v2-acceptance-catalog.ts`へ統一する。
旧Prompt・renderer・guard・repairの内部挙動を互換要件にしない。

動作確認では対象SHAと新しいConversation/turnを記録し、条件変更、検索カード、採用、再読込、同一turn再送を確認する。
旧の完了turnは保存済み回答をreplayするため、新実装の初回確認には使わない。
公開Issueに本物の会話・Profile・認証情報・内部思考を貼らない。fixture/CI成功を実モデル・実Provider・画面検証の完了へ読み替えない。

## 復旧

1. 問題のある変更を特定し、v2専用の実行入口を保った修正または部分revertをPRにする。DB・会話履歴は巻き戻さない。
2. 最後に動作確認できた**v2専用**SHAを基準にする。build、通常CI、v2 acceptanceを通し、新しいCDを実行する。
3. 上記のAWS設定読み戻しと対象フローの成功を別々に確認する。モデルだけ戻す場合もモデルIDを変更するPRを使い、旧フラグは復活させない。
4. 復旧SHA・UTC時刻・設定検証結果・成功/失敗を記録する。利用不能や権限/データ破損が続く間は入口を停止し、成功を装う応答へ切り替えない。

最初の撤去デプロイでは、直前のmain `638968af2aa8827a1cbdd4d188988d8900c8ec8b`も旧Runtimeを含む。
その旧bundleを新環境へ単純再配置すると、削除したフラグがないためv1を起動する。このため旧SHAのRe-run jobs、
旧bundle単体の再配置、Git全体の巻戻しは復旧手順にしない。
最初の復旧はv2必須の組成と旧フラグなしの設定を維持した修正/部分revertとして作成し、上の検証を通す。
撤去後の動作確認に成功したSHAを初めてのv2専用復旧基準として記録する。
