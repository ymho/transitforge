# ADR 0012: Cloudflare AOPとCloudFront viewer mTLSで配信入口を保護する

- ステータス: Accepted
- 日付: 2026-08-14

## コンテキスト

独自ドメインをCloudflareで配信しながら CloudFrontの既定ドメインからS3とAI APIへ直接到達できないようにしたい
Cloudflareの送信元IP範囲だけを許可する方法は変更追従が必要で Dedicated CDN Egress IPsはEnterprise契約が前提になる
秘密ヘッダはHTTP層まで接続を受け入れるため TLS層で拒否する方法より境界が弱い

## 決定

- 正規URLを`https://app.ohmyki.com`とする
- Cloudflareはproxied CNAMEで独自ドメインを新しいCloudFront Distributionへ接続する
- per-hostname Authenticated Origin Pullsへ専用クライアント証明書を設定する
- CloudFront viewer mTLSをrequired modeにして専用CAで署名された接続だけを受け入れる
- CloudFrontのHTTP/3を無効化し 全cache behaviorをHTTPS onlyにする
- Basic認証は独自ドメイン用Distributionで維持する
- 既存Distributionは切り替え完了後に正規URLへの308リダイレクト専用とする
- リダイレクト時はパスとクエリを維持する
- 既存DistributionからS3とLambdaのアクセス許可を外す
- ACM検証 AOP準備 独自ドメイン配信 既存URLリダイレクトの順に段階適用する
- CA秘密鍵とクライアント秘密鍵をGit Terraform state Issue PR CIログへ保存しない

## 影響

- Cloudflareを通らない新しいCloudFront接続はHTTP処理前のTLSハンドシェイクで拒否される
- 既存CloudFront URLをブックマークした利用者は正規URLへ移動できる
- CloudFront Distributionが2つになり固定費と反映待ち時間が増える
- AOPクライアント証明書の期限監視と安全なローテーションが必要になる
- 初回導入と証明書更新ではCloudflareへの秘密鍵アップロードを手作業で行う

## 代替案

### 単一Distributionのoptional mTLSとConnection Function

証明書なしの接続をTLS層で受け入れるため 設定不備が配信経路の露出につながりやすく採用しない

### 秘密ヘッダ

構成は単純だがHTTP層の共有秘密に依存するため採用しない

### Cloudflare Dedicated CDN Egress IPs

Akamai SiteShieldに近いが現在の利用条件に合わないため採用しない
