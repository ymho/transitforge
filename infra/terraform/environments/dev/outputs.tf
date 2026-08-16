output "website_bucket_name" {
  description = "Vite成果物とviewer-inputを配置するS3バケット名。"
  value       = aws_s3_bucket.website.id
}

output "cloudfront_distribution_id" {
  description = "デプロイ後のキャッシュ無効化に使用するCloudFront Distribution ID。"
  value       = var.cloudflare_front_door_enabled ? aws_cloudfront_distribution.viewer[0].id : aws_cloudfront_distribution.website.id
}

output "viewer_url" {
  description = "TransitForge開発環境の正規URL。"
  value       = var.cloudflare_front_door_enabled ? "https://${var.viewer_domain_name}" : "https://${aws_cloudfront_distribution.website.domain_name}"
}

output "legacy_cloudfront_url" {
  description = "独自ドメイン移行前のCloudFront URL。移行後は正規URLへリダイレクトする。"
  value       = "https://${aws_cloudfront_distribution.website.domain_name}"
}

output "viewer_cloudfront_domain_name" {
  description = "Cloudflare DNSのCNAME参照先。front door有効化前はnull。"
  value       = var.cloudflare_front_door_enabled ? aws_cloudfront_distribution.viewer[0].domain_name : null
}

output "viewer_certificate_dns_validation_records" {
  description = "Cloudflare DNSへ追加するACM検証用CNAME。"
  value = {
    for option in aws_acm_certificate.viewer.domain_validation_options : option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }
}

output "mtls_trust_store_bucket_name" {
  description = "Cloudflare AOPのCA証明書bundleを配置する非公開S3バケット名。"
  value       = aws_s3_bucket.mtls_trust_store.id
}

output "bedrock_agent_function_name" {
  description = "Amazon Bedrockを呼び出すAI駅員Lambdaの関数名。"
  value       = aws_lambda_function.bedrock_agent.function_name
}

output "ai_provider_egress_ip_address" {
  description = "楽天など送信元IP許可制の外部提供者へ登録するAI Lambdaの固定IPv4アドレス。"
  value       = aws_eip.ai_egress.public_ip
}

output "rakuten_travel_secret_name" {
  description = "楽天トラベル認証情報を登録するSecrets Managerの名前。値そのものはTerraformで管理しない。"
  value       = aws_secretsmanager_secret.rakuten_travel.name
}

output "github_actions_deploy_role_arn" {
  description = "GitHubのdev environmentからOIDCで引き受けるデプロイロールARN。"
  value       = aws_iam_role.github_deploy.arn
}

output "data_builder_github_deploy_role_arn" {
  description = "data-builderのGitHub Actionsが専用TerraformとECR公開で引き受けるIAMロールARN。"
  value       = aws_iam_role.data_builder_github_deploy.arn
}

output "train_monitor_archive_bucket_name" {
  description = "毎分の運行情報gzipスナップショットを保存するS3バケット名。"
  value       = aws_s3_bucket.train_monitor_archive.id
}

output "train_congestion_summary_table_name" {
  description = "Bedrockの日別ピーク検索に使用する毎分混雑サマリーテーブル名。"
  value       = aws_dynamodb_table.train_congestion_summary.name
}

output "train_delay_archive_bucket_name" {
  description = "1分ごとの列車遅延スナップショットを保存する非公開S3バケット名。"
  value       = aws_s3_bucket.train_delay_archive.id
}

output "train_delay_summary_table_name" {
  description = "AI向け列車遅延サマリーを保存するDynamoDBテーブル名。"
  value       = aws_dynamodb_table.train_delay_summary.name
}
