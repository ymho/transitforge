# Fixed-egress Accommodation Provider

## 呼出しと契約

`composition/fixed-egress-accommodation.ts`の`createFixedEgressAccommodationOperation(arn)`を
Server Toolのoperationへ注入できる。既存Usecase → `AccommodationProvider.search` →
`LambdaAccommodationProvider` → IAM同期Invoke → handler → `HttpAccommodationProvider`となる。
Tool descriptor/Evidence mapper/Agent decision policyを変更しない。

入力は以下のtyped operationだけ。requestの全5項目は必須で、既存日程/人数/件数検証に加え
存在しない暦日、未知キー、任意URL/method/headers/認証情報を拒否する。
requestIdは任意の英数字・ハイフン・アンダースコア128文字以内。JWT/user contextは渡さない。

```json
{
  "operation": "search_accommodation",
  "request": {
    "destination": "京都", "checkInDate": "2026-10-01", "checkOutDate": "2026-10-02",
    "adults": 1, "limit": 3
  },
  "requestId": "execution-1"
}
```

成功は`{ok:true, accommodations: AccommodationOffering[]}`のallowlist DTO。
候補数は最大5件、日程一致・ID/名称・数値範囲・価格観測・安全なHTTPSリンクを再検証する。
Provider raw JSON、追加フィールド、内部例外は返さない。
本番Rakuten adapterのサービス識別子は`rakuten-travel`、`providerItemId`は正の整数の施設番号`hotelNo`である。移行互換の`travel-provider`も受信できるがサービス/施設の同定済みとは扱わず、選択保存用の証拠を生成しない。保持方針は[宿泊Snapshot](../specs/trip-accommodation.md)を参照する。
失敗は`{ok:false,error:{code,retryable}}`のみ。

| code | retryable |
| --- | --- |
| invalid_request / provider_4xx / malformed_response / oversized_result | false |
| provider_timeout / provider_throttled / provider_5xx / unavailable | true |

入力2 KiB、応答32 KiB、HTTP応答読取り256 KiB、各文字列2,048文字を上限とする。
HTTP redirectを拒否し、accessKeyを別hostへ転送しない。反射された認証情報も拒否する。
handlerはevent/result/例外をログ出力しない。SDKのFunctionErrorとHTTP非成功の本文は破棄する。
HTTP空室確認の失敗時は既存仕様どおり発見済み候補を空室未確認・参考料金として返す。

## IAM・credentials・network

- default-offの専用Lambda。public URL/API/resource policyはない。利用者認証はServer入口の責務。
- `fixed_egress_agent_role_name`で指定するServer roleへ、当該関数ARNだけのInvokeFunctionを付与可能。
  未指定ならgrantなし。Browser/Cognito tokenはこの境界に関与しない。
- Provider roleは専用SecretのGetSecretValue、専用log groupへの書込み、VPC ENI管理だけを持つ。
  EC2 ENI lifecycleの`Resource:*`はVPC Lambdaに必要な例外。Invoke/SecretはARNを限定する。
- `/transitforge/dev/fixed-egress-travel-provider`は宿泊専用Secretの器。従来の
  SecretsManagerTravelProviderCredentialsと同じapplication_id/access_key/hotel_search_url/
  任意vacant_hotel_search_url/affiliate_id形式。値はTerraform・Git・Agent環境変数へ置かない。
- `aws_subnet.ai_egress_private`と`aws_security_group.ai_lambda`を再利用する。
  既存SGはinboundなし/outbound HTTPSのみ、既存NAT SGがこのSGから443だけを受信する。
- `aws_eip.ai_egress`、`aws_eip_association.ai_nat`、`aws_instance.ai_nat`を変更しない。
  EIP replacementを生むresource identity/引数の変更はない。実planによる保証は統合時に行う。

## timeout / retry

Secrets Managerは3秒、HTTPは各8秒（discoveryとvacancyの最大2回）、Lambdaは25秒、
Invoke側は30秒。3 + 8 + 8秒にLambda/serializationの余裕を加える。
既存HTTPのabort timerは本文読取りも覆う。Secrets/Invoke SDKは`maxAttempts:1`、HTTP retryなし。
[Lambda Invoke仕様](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)に従い
RequestResponse/LogType Noneを使い、StatusCodeとFunctionErrorを別々に確認する。

Usecaseはbounded errorをretryableなら503、そうでなければ422へ写し、既存Server Toolが
retryableを維持する。Runtimeは全体deadlineとTool回数上限内でモデルによる再試行を判断する。
自動の下位retryを重ねない。Runtimeの期限が先に切れる/Browserが切断する場合、Invokeのabortは
遠隔Lambdaを停止しないため最大25秒までProvider処理が残り得る。検索はread-only。

モデル設定とSDKの境界は[Server Agent](agent-runtime.md)、読み戻し・復旧は[運用手順](../operations/agent-deployment.md)を参照する。
