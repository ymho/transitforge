# ADR 0039 Amadeus Self-Serviceで航空便候補を検索する

## 状態

採用 ただし認証情報未設定時は無効

## 決定

航空便の候補発見にはAmadeus Self-ServiceのFlight Offers Searchを使う
独立開発者向けSelf-Service Productionは月次無料枠と超過分の従量課金を持つため 個人開発でも開始できる

Provider固有の応答は`FlightSearchProvider`境界で正規化し 時刻 価格 販売可否をLLMに生成させない
検索結果は15分でstaleになるEvidenceを持つ
認証情報がない場合は`unavailable` 価格や販売可否が応答にない場合は`unknown`として扱う

Secret JSONへ次を任意追加する

- `amadeus_client_id`
- `amadeus_client_secret`
- `amadeus_base_url` 省略時はproduction endpoint

保存先は既存Secret JSONと共有するが Application Portは宿泊認証情報と分ける。
`FlightProviderCredentialsRepository`は航空便の項目だけを読み 宿泊Providerの必須項目へ依存しない。
これにより将来Secretを分離してもFlight AdapterとUsecaseを変更しない。

## 制約

Self-Serviceには一部航空会社やLCCが含まれない
Raiquoraは予約 発券 決済を行わず 航空会社網羅性を保証しない
空港までの鉄道経路は既存の決定論的Journey Toolで別に検索する

## 参照

- https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/
- https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/
