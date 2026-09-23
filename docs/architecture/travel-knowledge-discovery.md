# 旅行知識Discovery / Applicability

## 本番経路

`search_travel_knowledge`はServer Agentのread Toolである。typed facetsを`discoverTravelCandidates`へ渡し、Webと有効化済みKnowledge Baseを同じ`DiscoveryHit`へ正規化する。rank fusion後、設定時だけBedrock Rerankを実行する。HitはObservation/Evidenceへ変換して既存のGrounding経路へ渡し、Browserを検索の正本にしない。

| 構成 | 取得 | 再順位付け | 実行可能性 |
| --- | --- | --- | --- |
| Web-only | Brave Web | 元順位/RRF | Applicabilityで別評価 |
| Web + Rerank | Brave Web | Bedrock Rerank | Applicabilityで別評価 |
| Knowledge + Web | Retrieve + Brave Web | RRF、任意Rerank | Applicabilityで別評価 |

Rerank scoreは文書関連度であり、営業中、空席、費用、移動成立、推薦確率ではない。`TravelApplicabilityFact`は`opening_windows`、`access_requirement`、`visit_requirement`、`seasonal_relevance`だけを初期variantとし、日付未定・地点未解決・対象外scope・参加者不明を`unknown`にする。例外休業は通常窓より優先する。

## Provider capability

| Provider | typed fact | coverage / limitation |
| --- | --- | --- |
| Mapbox Ground Access | access lower bound | 検証済みstation/place identityと徒歩・車・自転車のみ |
| Mapbox Place | visit requirement unknown | Place identityと資料。自由文営業時間を構造化営業保証へ昇格しない |
| Web page | model-extracted候補 | exact source span検証まで。human/provider structuredと区別 |
| Bedrock KB Retrieve | DiscoveryHit | metadata欠損時subject未同定。HYBRIDは対応storeのfilterable text構成だけ。S3 VectorsはSEMANTIC |

検索snippetや本文先頭1,200文字をcompleteとは扱わない。保持禁止の本文はEvidence、Trace、cacheへ残さずreferenceだけを保持する。共有Knowledge BaseへProfile、会話、予約、支払、個人情報を投入しない。

## 有効化とLive測定

1. `travel-knowledge-manifest.schema.json`へ適合し、親文書から例外日まで追跡可能なmanifestを作る。
2. 対象regionのKnowledge Base、vector store、reranker model対応をAWS公式仕様で再確認する。
3. Terraform変数へ既存KB ID、vector store capability、requested search type、任意reranker ARNを設定する。
4. `terraform plan`で`bedrock:Retrieve`が対象KB ARNだけ、`bedrock:Rerank`がgate時だけ付与されることを確認する。
5. 同じtyped input、source集合、budgetでWeb-only / Web+Rerank / Knowledge+Webを実行し、候補recall/diversity、順位、invalid index、latency、取得件数、推定費用を記録する。
6. ingestion/update/delete後はmanifest revision、index、Application cacheを同時に更新し、削除sourceを再提示しないことを確認する。

このリポジトリの設定はdefault-offであり、adapter存在だけを本番接続済みとは記録しない。

AWS公式参照（2026-09-23確認）:

- [Knowledge Base query configuration / HYBRID capability](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html)
- [Retrieve metadata filtering](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_KnowledgeBaseVectorSearchConfiguration.html)
- [Rerank permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-prereq.html)
- [Rerank API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_Rerank.html)
