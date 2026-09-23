# ADR 0077: 旅行候補発見をObservation lineageへ統合する

- ステータス: Accepted
- 日付: 2026-09-23
- 関連: #546、#547、ADR 0042、0074

## 背景

Web検索、Place、宿泊、地上アクセスは本番経路に存在するが、Evidence IDは問い合わせ日程や人数と独立し、同一IDがfirst-winsで捨てられていた。検索結果の関連度と、特定日の営業・アクセス・参加条件も区別できなかった。Knowledge retrievalやRerankを追加しても、このままでは検索スコアを旅行成立性として誤用する。

## 決定

Provider非依存の`DiscoveryQuery/Hit/Batch`と`TravelApplicabilityFact`を共有Runtimeへ置く。検索は複数facetからboundedなqueryを作り、source identity単位のreciprocal-rank fusionを行う。Rerankは文書関連度だけを変更し、hard constraint、費用、負荷、成立性、最終推薦順位を変更しない。

Evidenceは`observationId`、`subjectKey`、`scopeKey`を分離する。同一ID・同一内容は冪等、同一ID・異内容はcollision、同一subject/predicate/scopeの相違はconflictingとして両方を保持する。ClaimはEvidence IDだけでsupportedにせず、field、subject、applicability scope、許可transformを束縛する。失効・撤回・競合は派生評価を`needs_recheck`へ戻すが、過去の採用SnapshotやReservationを変更しない。

Bedrock Knowledge Basesには`Retrieve`を使い、`RetrieveAndGenerate`の自由文を正本にしない。明示metadata filterを渡し、HYBRIDはfilterable text fieldを持つOpenSearch Serverless、RDS、MongoDBの対応構成でだけ指定する。S3 Vectors等ではSEMANTICへ降格した事実をcoverageへ残す。独立Rerankは返却indexの範囲・重複・欠落を検査し、失敗時は元順位へ明示fallbackする。

Knowledge Base ID、vector store capability、search type、reranker ARNはdefault-off設定とする。Application roleには有効化時だけ`bedrock:Retrieve`と`bedrock:Rerank`を追加し、対象KBはARNで限定する。Knowledge Base/Vector Storeの作成、ingestion、課金Live試験はこのADRの適用条件ではない。

## 公式仕様の確認

2026-09-23時点のAWS公式仕様で、Retrieveのmetadata filter、独立Rerank、Rerank index、HYBRIDの対応store/filterable text field条件、S3 Vectorsの制約を確認した。実環境有効化前にregionのmodel availabilityとvector store capabilityを再確認する。

## 影響

- Web-only、Web+Rerank、Knowledge+Webを同じHit/予算契約で比較できる。
- 未同定subjectを架空Place IDへ昇格しない。
- raw本文、private Profile、予約情報を共有KBへ投入しない。
- Knowledge source削除・更新はmanifest revisionと親文書参照から再取込対象を決め、Application cacheも無効化する必要がある。

## 検証

無課金fixtureで複数facet、同名別施設、転載/chunk重複、metadata欠損、HYBRID降格、Rerank不正index/障害、Evidence collision、別日・別人数、失効を確認する。Live試験は別手順でmodel/region、latency、token相当、費用、取得件数を記録する。
