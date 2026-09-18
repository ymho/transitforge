# ADR 0071: 固定送信元IPが必要な宿泊Provider通信を専用Lambdaへ分離する

- ステータス: Accepted（構成はdefault-off、production未接続）
- 日付: 2026-09-19
- 関連: #480 Phase B、ADR 0019 / 0020 / 0068

## 決定

ADR 0019の「固定送信元IPv4が必要」という判断は維持する。
最終構成はVPC外のServer Agent → AccommodationProvider Port → IAM Invoke →
専用Provider Lambda → 既存private subnet → 既存NAT instance → 既存Elastic IPとする。
旧AI Lambda全体をVPCへ置く責務だけを部分置換する。ADR 0019本文は変更しない。
今回の対象は既存Travel/Accommodation Providerの宿泊候補・日付別空室検索だけとする。
他Providerに固定IP要件があると推測して一律VPCへ入れない。

専用Lambdaは認証情報取得、HttpAccommodationProvider、HTTP timeout、応答検証、
bounded error正規化だけを所有する。Agent Runtime、Bedrock、Evidence、Claim、Grounding、
State、利用者認証は所有しない。既存Port/Usecaseを維持し、Server側Adapterだけを置換する。
新しいAWS SDK client-lambdaはIAM署名付き同期Invokeのために追加する。新規frameworkは不要。

Provider URL/認証情報は専用Secrets Managerから取得する。既存SecretはMapboxやWeb検索の
キーも共有しているため、宿泊専用Secretの器を追加し、値はTerraformへ置かない。
Server roleには専用LambdaのInvokeFunctionだけを付与し、このSecretを読む権限は与えない。
既存AI Lambda・共有Secret・VPC設定はcutoverまで維持する。

公開Function URL/API、Browser直接呼出し、JWT転送、任意URL/headers/methodのproxyは作らない。
DTOとtimeout/retry、移行手順は[専用Provider境界](../architecture/fixed-egress-provider.md)を正本とする。

## 影響

既存VPC/subnet/HTTPS SG/NAT/EIP resource identityを保つ。SGは既存AI Lambda用を再利用する。
外向きTCP 443だけを許可し、Provider Lambdaへのinboundは追加しない。
Terraformの既定値では専用リソースもInvoke grantも作らず、本番の接続先を変えない。
有効化後はLambda同期呼出しと専用Secretの費用・レイテンシが増える。
NATの単一AZ/単一instance制約は維持する。

read-only検索であり、副作用idempotencyやキューは追加しない。上位のtimeout/切断後に
Provider Lambdaが処理を続け得る。Provider境界にはretryを追加せずAgentのbounded policyへ集約する。
