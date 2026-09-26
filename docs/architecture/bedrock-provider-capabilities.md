# Bedrock Provider capability matrix

確認日: 2026-09-26。正本はAWS公式の[Structured Outputs](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html)と[Prompt Caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)、および承認済み環境で保存したcontract probe結果である。

| 利用候補 | API | region | Structured text | strict Tool | Prompt Cache | 状態 |
|---|---|---|---|---|---|---|
| `amazon.nova-lite-v1:0`（旧V2基準・比較用） | Converse | model提供region | 非対応 | 非対応 | explicit: system/messages, 最低1K, 最大4, TTL 5分 | AWS model card確認、Live probe未実施 |
| `LIGHTWEIGHT_MODEL_ID` | Converse | deployment region | 未実測 | 未実測 | 未実測 | 任意設定、実IDのprobe未実施 |
| `jp.amazon.nova-2-lite-v1:0`（V2 production既定） | Converse | JP cross-region profile | 非対応 | 非対応 | explicit: system/messages, 最低1K, 最大4, TTL 5分 | AWS model card確認、Live probe未実施 |

`BEDROCK_CAPABILITY_MATRIX_JSON`は完全一致するmodel IDごとにレビュー済み結果を与える。未設定・未登録modelは`unmeasured`であり、model名部分一致では昇格しない。`BEDROCK_PROMPT_CACHING_ENABLED=true`かつmatrixが対応を示す場合だけcachePointを送る。

Converseのassistant応答に含まれる`reasoningContent`はprovider内部の推論であり、Applicationの表示・Tool実行・会話履歴の契約には含めない。Adapter境界で形式を検証して破棄し、同じ応答の`text`または`toolUse`だけを既存の厳格なmessage検証へ渡す。推論しかない応答や不正な推論blockは正常応答へ昇格しない。

応答検証で失敗した際の運用診断は、ブロックの閉じた種類・件数と検証失敗の分類だけをCloudWatchへ出す。本文、内部推論、Tool入力、未知フィールド名、例外文字列、ユーザ識別子は出さない。CDと手動の診断Workflowではこの分類だけを集計し、実際の失敗型が確認できるまでは原因を推定で確定しない。

Bedrockのassistant `toolUse.name`は、そのモデル呼び出しで実際に公開したTool descriptor名との完全一致で検証する。HTTP入力の固定許可リストをprovider応答へ流用しない。新しいServer Tool（例: `search_travel_knowledge`）も公開済みなら受け入れ、未公開Toolは拒否する。HTTP利用者のmessage検証に使う固定許可リストは維持する。

```json
{
  "provider.model-id": {
    "structuredTextOutput": "supported",
    "strictToolUse": "supported",
    "streaming": "supported",
    "citations": "unsupported",
    "promptCaching": { "mode": "explicit", "checkpointFields": ["tools"], "minimumTokens": 1024, "maximumCheckpoints": 4, "ttlSeconds": 300 },
    "source": "contract-probe",
    "verifiedAt": "2026-09-23"
  }
}
```

ローカルadapter fixtureはpayload契約だけを検証する。cold/warm latency、repair率、token、cache read/write、拒否/打切りのLive値ではない。schema compilation cache、Bedrock Prompt Cache、検索結果cacheは別指標で扱う。
