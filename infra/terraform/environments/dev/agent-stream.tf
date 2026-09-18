# #480 Phase A: short-lived infrastructure gate, removed after the authenticated cutover.
variable "agent_stream_enabled" {
  description = "Create the opt-in REST streaming path; never switches the production Browser. Remove after #480 cutover."
  type        = bool
  default     = false
}
variable "server_agent_max_execution_ms" {
  description = "Server Agent business deadline, independent of transport. 120s recommended, at most 180s reserves 60s before Lambda timeout."
  type        = number
  default     = 120000
  validation {
    condition     = var.server_agent_max_execution_ms >= 1000 && var.server_agent_max_execution_ms <= 180000 && floor(var.server_agent_max_execution_ms) == var.server_agent_max_execution_ms
    error_message = "Server Agent deadline must be an integer from 1000 to 180000 milliseconds."
  }
}
locals {
  agent_stream_instances = var.agent_stream_enabled ? { stream = true } : {}
  agent_stream_name      = "${var.project_name}-${var.environment}-agent-stream"
  # One source for Gateway resource, permission, Lambda validation and CloudFront behavior.
  # #480 cutover changes this to agent only alongside retirement of the existing behavior.
  agent_stream_path_part = "agent-stream"
  agent_stream_path      = "/api/${local.agent_stream_path_part}"
  agent_stream_package   = jsondecode(file("${path.module}/../../../packaging/agent-stream.json"))
}
data "archive_file" "agent_stream" {
  for_each    = local.agent_stream_instances
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.agent_stream_package.source}"
  output_path = "${path.module}/.terraform/agent-stream.zip"
}
resource "aws_iam_role" "agent_stream" {
  for_each = local.agent_stream_instances
  name     = local.agent_stream_name
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_cloudwatch_log_group" "agent_stream" {
  for_each          = local.agent_stream_instances
  name              = "/aws/lambda/${local.agent_stream_name}"
  retention_in_days = 30
}
resource "aws_iam_role_policy" "agent_stream_logs" {
  for_each = local.agent_stream_instances
  role     = aws_iam_role.agent_stream[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.agent_stream[each.key].arn}:*"
  }] })
}
resource "aws_lambda_function" "agent_stream" {
  for_each                       = local.agent_stream_instances
  function_name                  = local.agent_stream_name
  role                           = aws_iam_role.agent_stream[each.key].arn
  filename                       = data.archive_file.agent_stream[each.key].output_path
  source_code_hash               = data.archive_file.agent_stream[each.key].output_base64sha256
  runtime                        = local.agent_stream_package.runtime
  handler                        = local.agent_stream_package.handler
  architectures                  = ["arm64"]
  memory_size                    = 1024
  timeout                        = 240
  reserved_concurrent_executions = 1
  environment {
    variables = {
      SERVER_STATE_TABLE_NAME            = aws_dynamodb_table.server_state.name
      TRIP_TABLE_NAME                    = aws_dynamodb_table.trips.name
      FIXED_EGRESS_PROVIDER_FUNCTION_ARN = var.enable_fixed_egress_provider ? aws_lambda_function.fixed_egress_provider[0].arn : ""
      AGENT_PROVIDER_SECRET_ARN          = aws_secretsmanager_secret.agent_stream_providers[each.key].arn
      AI_TIMETABLE_BUCKET                = "${local.resource_prefix}-data-builder-source"
      PLANNING_TIMETABLE_PREFIX          = "timetable"
      TRAFFIC_SNAPSHOT_BUCKET            = aws_s3_bucket.website.id
      VIEWER_ORIGIN                      = "https://${var.viewer_domain_name}"
      SERVER_AGENT_MAX_EXECUTION_MS      = tostring(var.server_agent_max_execution_ms)
      AGENT_STREAM_ENABLED               = "true"
      AGENT_STREAM_PATH                  = local.agent_stream_path
      COGNITO_USER_POOL_ID               = aws_cognito_user_pool.users.id
      COGNITO_CLIENT_ID                  = aws_cognito_user_pool_client.spa.id
      MODEL_ID                           = var.bedrock_model_id
      LIGHTWEIGHT_MODEL_ID               = var.bedrock_lightweight_model_id
      DECISION_MODEL_ID                  = var.bedrock_decision_model_id
    }
  }
  depends_on = [aws_iam_role_policy.agent_stream_logs, aws_iam_role_policy.agent_stream_model]
  lifecycle {
    precondition {
      condition     = var.enable_fixed_egress_provider
      error_message = "Stateful streaming requires the fixed-egress Provider boundary."
    }
  }
  # No VPC, Function URL or Travel Provider credentials on the Agent Runtime.
}
resource "aws_api_gateway_rest_api" "agent_stream" {
  for_each = local.agent_stream_instances
  name     = local.agent_stream_name
  endpoint_configuration { types = ["REGIONAL"] }
}
resource "aws_api_gateway_resource" "agent_stream_api" {
  for_each    = local.agent_stream_instances
  rest_api_id = aws_api_gateway_rest_api.agent_stream[each.key].id
  parent_id   = aws_api_gateway_rest_api.agent_stream[each.key].root_resource_id
  path_part   = "api"
}
resource "aws_api_gateway_resource" "agent_stream_route" {
  for_each    = local.agent_stream_instances
  rest_api_id = aws_api_gateway_rest_api.agent_stream[each.key].id
  parent_id   = aws_api_gateway_resource.agent_stream_api[each.key].id
  path_part   = local.agent_stream_path_part
}
resource "aws_api_gateway_authorizer" "agent_stream_cognito" {
  for_each        = local.agent_stream_instances
  name            = "existing-cognito"
  rest_api_id     = aws_api_gateway_rest_api.agent_stream[each.key].id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [aws_cognito_user_pool.users.arn]
  identity_source = "method.request.header.Authorization"
}
resource "aws_api_gateway_method" "agent_stream_post" {
  for_each             = local.agent_stream_instances
  rest_api_id          = aws_api_gateway_rest_api.agent_stream[each.key].id
  resource_id          = aws_api_gateway_resource.agent_stream_route[each.key].id
  http_method          = "POST"
  authorization        = "COGNITO_USER_POOLS"
  authorizer_id        = aws_api_gateway_authorizer.agent_stream_cognito[each.key].id
  authorization_scopes = aws_cognito_resource_server.api.scope_identifiers
}
resource "aws_api_gateway_integration" "agent_stream_route" {
  for_each                = local.agent_stream_instances
  rest_api_id             = aws_api_gateway_rest_api.agent_stream[each.key].id
  resource_id             = aws_api_gateway_resource.agent_stream_route[each.key].id
  http_method             = aws_api_gateway_method.agent_stream_post[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.agent_stream[each.key].response_streaming_invoke_arn
  response_transfer_mode  = "STREAM"
  timeout_milliseconds    = 250000
}
resource "aws_lambda_permission" "agent_stream_gateway" {
  for_each      = local.agent_stream_instances
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agent_stream[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.agent_stream[each.key].execution_arn}/${var.environment}/POST${local.agent_stream_path}"
}
resource "aws_api_gateway_deployment" "agent_stream" {
  for_each    = local.agent_stream_instances
  rest_api_id = aws_api_gateway_rest_api.agent_stream[each.key].id
  triggers = { configuration = sha1(jsonencode([
    aws_api_gateway_integration.agent_stream_route[each.key], aws_api_gateway_method.agent_stream_post[each.key], aws_api_gateway_authorizer.agent_stream_cognito[each.key]
  ])) }
  lifecycle { create_before_destroy = true }
}
resource "aws_api_gateway_stage" "agent_stream" {
  for_each      = local.agent_stream_instances
  rest_api_id   = aws_api_gateway_rest_api.agent_stream[each.key].id
  deployment_id = aws_api_gateway_deployment.agent_stream[each.key].id
  stage_name    = var.environment
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.agent_stream_api[each.key].arn
    format = jsonencode({
      requestId            = "$context.requestId", apiRequestId = "$context.extendedRequestId",
      status               = "$context.status", latencyMs = "$context.responseLatency",
      integrationLatencyMs = "$context.integration.latency"
    })
  }
  depends_on = [aws_api_gateway_account.agent_stream]
}
resource "aws_api_gateway_method_settings" "agent_stream" {
  for_each    = local.agent_stream_instances
  rest_api_id = aws_api_gateway_rest_api.agent_stream[each.key].id
  stage_name  = aws_api_gateway_stage.agent_stream[each.key].stage_name
  method_path = "*/*"
  settings {
    logging_level          = "OFF"
    caching_enabled        = false
    data_trace_enabled     = false
    metrics_enabled        = true
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }
}

resource "aws_iam_role_policy" "agent_stream_model" {
  for_each = local.agent_stream_instances
  role     = aws_iam_role.agent_stream[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["bedrock:InvokeModel"], Resource = concat(
      [for id in local.bedrock_foundation_model_ids : "arn:aws:bedrock:${var.aws_region}::foundation-model/${id}"],
      [for id in local.bedrock_inference_profile_ids : "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${id}"],
      [for id in local.bedrock_inference_profile_model_ids : "arn:aws:bedrock:*::foundation-model/${id}"]
    )
  }] })
}
resource "aws_cloudwatch_log_group" "agent_stream_api" {
  for_each          = local.agent_stream_instances
  name              = "/aws/apigateway/${local.agent_stream_name}"
  retention_in_days = 30
}
resource "aws_iam_role" "agent_stream_gateway_logs" {
  for_each = local.agent_stream_instances
  name     = "${local.agent_stream_name}-gateway-logs"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "apigateway.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy_attachment" "agent_stream_gateway_logs" {
  for_each   = local.agent_stream_instances
  role       = aws_iam_role.agent_stream_gateway_logs[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}
# Account/region singleton: coordinate ownership with #451 before enabling; do not create another owner.
resource "aws_api_gateway_account" "agent_stream" {
  for_each            = local.agent_stream_instances
  cloudwatch_role_arn = aws_iam_role.agent_stream_gateway_logs[each.key].arn
  depends_on          = [aws_iam_role_policy_attachment.agent_stream_gateway_logs]
}
output "agent_stream_route" {
  description = "Internal opt-in path; not published to Browser configuration."
  value       = var.agent_stream_enabled ? local.agent_stream_path : null
}

# Dedicated non-travel credentials only; values are provisioned separately, never in Terraform.
resource "aws_secretsmanager_secret" "agent_stream_providers" {
  for_each = local.agent_stream_instances
  name     = "${local.agent_stream_name}-providers"
}
resource "aws_iam_role_policy" "agent_stream_state" {
  for_each = local.agent_stream_instances
  role     = aws_iam_role.agent_stream[each.key].id
  policy   = data.aws_iam_policy_document.server_state_storage.json
}
resource "aws_iam_role_policy" "agent_stream_dependencies" {
  for_each = local.agent_stream_instances
  role     = aws_iam_role.agent_stream[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.trips.arn },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.agent_stream_providers[each.key].arn },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["arn:aws:s3:::${local.resource_prefix}-data-builder-source/timetable/*", "arn:aws:s3:::${local.resource_prefix}-data-builder-source/ai-timetable/*", "${aws_s3_bucket.website.arn}/api/traffic/delays.json"] }
  ] })
}
resource "aws_iam_role_policy" "agent_stream_provider_invoke" {
  for_each = var.enable_fixed_egress_provider ? local.agent_stream_instances : {}
  role     = aws_iam_role.agent_stream[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.fixed_egress_provider[0].arn }
  ] })
}
