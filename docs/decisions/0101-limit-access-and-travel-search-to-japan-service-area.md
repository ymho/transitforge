# ADR 0101: 日本からのアクセスと32都府県の旅行検索に限定する

- ステータス: Accepted
- 日付: 2026-10-11
- 一部置換: [ADR 0066](0066-derive-service-coverage-from-loaded-timetables.md)

## 背景

利用元の国を日本に限定し、観光地を含む検索対象を収集対象の鉄道路線が通る都府県に揃える製品方針を採用する。時刻表・施設アクセスの確認とは別の境界を必要とする。

## 決定

製品の検索対象はTrip Domainの32都府県policyが所有し、Applicationが地点・宿・飲食店・Web資料・Knowledge結果に共通適用する。行政区画と住所を優先し、未知の場所はboundedな地理照会で補う。未解決や対象外の結果を推薦用Tool応答へ渡さない。Promptにも範囲を知らせるが、除外の正本はApplicationとする。

Cloudflare AOPとrequired viewer mTLSを持つ配信入口はCloudflareの国ヘッダーを検証し、JPだけ許可する。直接利用される旧CloudFront入口はIPによるJP whitelistとする。API GatewayはCognitoに加えてCloudFrontが付与する非公開origin keyを要求し、API URLからの国制限迂回を閉じる。

OTPへは地域ごとの複数GTFSと対応OSMを投入できるようにする。manifestには各feedのID・出典・hash・範囲・運行期間を保持する。集約した長方形や最長運行期間を全地域の検索対応へ昇格しない。明示的なregion・version・graph hash・OTP imageを固定し、既存v1を維持する。

## 影響と代替案

対象県の候補でも移動成立は時刻表・GroundAccess・OTPの別検証を要する。検索範囲をLLMだけに任せる案と、駅カタログ掲載だけで対象を拡大する案は採用しない。将来の県追加にはpolicyとデータのレビューを要する。初回origin key配布は二段階で行い、国ヘッダーが届くことと国内利用を確認する。全国のバス対応をこの変更だけで保証しない。
