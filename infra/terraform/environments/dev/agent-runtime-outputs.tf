# Read back the exact function configured by the existing Agent API integration.
output "agent_stream_function_name" {
  description = "Agent実行経路のデプロイ後検証に使う既存Lambda関数名。"
  value       = one(values(aws_lambda_function.agent_stream)).function_name
}
