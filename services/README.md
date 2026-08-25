# Backend services

TerraformやAWSリソース定義から独立してテストできるBackend Applicationを置く

## agent-api

`agent-api`は経路検索 運行分析 旅行候補 Agent会話 Evidence Trace Feedbackを提供する
Lambdaの`handler.lambda_handler`はAWSイベント変換 Client生成 設定注入だけを担当する
リクエストの分岐は`agent_application.py` Provider固有の会話は`bedrock_conversation.py`へ置く
鉄道検索と分析は既存の決定論的モジュールへ委譲する

Lambda zip内で`handler.py`と既存module名をrootへ置く互換性を維持するため Pythonファイルは当面flatに配置する
Terraformは`services/agent-api`をpackage元とし `__pycache__`とbytecodeを除外する

リポジトリrootから次を実行する

```bash
python3 -m unittest discover -s tests -v
python3 tools/run_journey_search_scenarios.py
```

`services`からTerraform state AWS credential 環境固有resource名を参照しない
外部ClientはhandlerまたはAdapter境界から注入する
