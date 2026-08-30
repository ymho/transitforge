# ADR 0039 Amadeus Self-Serviceで航空便候補を検索する

## 状態

廃止

## 決定

航空便検索は現在の旅行支援範囲から外し Amadeus Adapter `search_flights` Tool
認証情報契約 UI表示 Evaluationケースを削除する

鉄道を中心とする決定論的な移動検索と 防災 駅から先の移動 飲食店検索を優先し
未使用の外部Providerを維持しない

## 制約

過去に採用した判断の記録としてADRは残す
航空便検索を再導入する場合は目的 評価指標 Providerの網羅性と費用を改めて判断する

## 参照

- https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/
- https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/
