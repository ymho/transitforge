output "website_bucket_name" {
  description = "Vite成果物とviewer-inputを配置するS3バケット名。"
  value       = aws_s3_bucket.website.id
}

output "cloudfront_distribution_id" {
  description = "デプロイ後のキャッシュ無効化に使用するCloudFront Distribution ID。"
  value       = aws_cloudfront_distribution.website.id
}

output "viewer_url" {
  description = "TransitForge開発環境のCloudFront URL。"
  value       = "https://${aws_cloudfront_distribution.website.domain_name}"
}

output "bedrock_agent_function_name" {
  description = "Amazon Bedrockを呼び出すAI運行観察員Lambdaの関数名。"
  value       = aws_lambda_function.bedrock_agent.function_name
}

output "github_actions_deploy_role_arn" {
  description = "GitHubのdev environmentからOIDCで引き受けるデプロイロールARN。"
  value       = aws_iam_role.github_deploy.arn
}

output "train_monitor_archive_bucket_name" {
  description = "毎分の運行情報gzipスナップショットを保存するS3バケット名。"
  value       = aws_s3_bucket.train_monitor_archive.id
}

output "train_monitor_collector_function_name" {
  description = "運行情報収集Lambdaの関数名。"
  value       = aws_lambda_function.train_monitor_collector.function_name
}

output "train_monitor_schedule_name" {
  description = "1分間隔で収集Lambdaを実行するEventBridge Scheduler名。"
  value       = aws_scheduler_schedule.train_monitor_collector.name
}

output "train_congestion_summary_table_name" {
  description = "Bedrockの日別ピーク検索に使用する毎分混雑サマリーテーブル名。"
  value       = aws_dynamodb_table.train_congestion_summary.name
}

output "train_delay_archive_bucket_name" {
  description = "1分ごとの収録事業者列車遅延スナップショットを保存する非公開S3バケット名。"
  value       = aws_s3_bucket.train_delay_archive.id
}

output "train_delay_collector_function_name" {
  description = "収録事業者列車遅延情報を収集するLambda関数名。"
  value       = aws_lambda_function.train_delay_collector.function_name
}

output "train_delay_schedule_name" {
  description = "1分間隔で遅延収集Lambdaを実行するEventBridge Scheduler名。"
  value       = aws_scheduler_schedule.train_delay_collector.name
}

output "train_delay_summary_table_name" {
  description = "AI向け列車遅延サマリーを保存するDynamoDBテーブル名。"
  value       = aws_dynamodb_table.train_delay_summary.name
}
