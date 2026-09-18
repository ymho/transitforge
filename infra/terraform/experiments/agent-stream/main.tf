# Isolated opt-in experiment. Never included by environments/dev or CD / Deploy.
terraform {
  required_version = ">= 1.12.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.57.1"
    }
  }
}
provider "aws" { region = var.region }
variable "enabled" {
  type    = bool
  default = false
}
variable "region" {
  type    = string
  default = "ap-northeast-1"
}
variable "user_pool_arn" {
  type    = string
  default = ""
}
variable "user_pool_id" {
  type    = string
  default = ""
}
variable "client_id" {
  type    = string
  default = ""
}
variable "lambda_zip" {
  type    = string
  default = "agent-stream-poc.zip"
}
variable "scenario" {
  type    = string
  default = "immediate"
  validation {
    condition     = contains(["immediate", "over30", "ninety", "minutes", "initial_delay", "initial_silent", "silent", "mid_error", "missing_final", "server_agent"], var.scenario)
    error_message = "Select a bounded fixture scenario."
  }
}
locals {
  instances = var.enabled ? { poc = true } : {}
}
resource "aws_iam_role" "poc" {
  for_each = local.instances
  name     = "raiquora-agent-stream-poc"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_cloudwatch_log_group" "poc" {
  for_each          = local.instances
  name              = "/aws/lambda/raiquora-agent-stream-poc"
  retention_in_days = 3
}
resource "aws_iam_role_policy" "logs" {
  for_each = local.instances
  role     = aws_iam_role.poc[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.poc[each.key].arn}:*"
  }] })
}
resource "aws_lambda_function" "poc" {
  for_each                       = local.instances
  function_name                  = "raiquora-agent-stream-poc"
  role                           = aws_iam_role.poc[each.key].arn
  filename                       = var.lambda_zip
  source_code_hash               = var.enabled ? filebase64sha256(var.lambda_zip) : null
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  architectures                  = ["arm64"]
  memory_size                    = 256
  timeout                        = 240
  reserved_concurrent_executions = 1
  environment {
    variables = {
      AGENT_STREAM_POC_ENABLED  = "true"
      AGENT_STREAM_POC_SCENARIO = var.scenario
      COGNITO_USER_POOL_ID      = var.user_pool_id
      COGNITO_CLIENT_ID         = var.client_id
    }
  }
  lifecycle {
    precondition {
      condition     = var.user_pool_arn != "" && var.user_pool_id != "" && var.client_id != ""
      error_message = "Use the existing #451 test User Pool and client; this experiment does not create Cognito resources."
    }
  }
  # No VPC, Bedrock, repository or external Provider permissions. Synthetic/fake model only.
}
resource "aws_api_gateway_rest_api" "poc" {
  for_each = local.instances
  name     = "raiquora-agent-stream-poc"
  endpoint_configuration { types = ["REGIONAL"] }
}
resource "aws_api_gateway_resource" "api" {
  for_each    = local.instances
  rest_api_id = aws_api_gateway_rest_api.poc[each.key].id
  parent_id   = aws_api_gateway_rest_api.poc[each.key].root_resource_id
  path_part   = "api"
}
resource "aws_api_gateway_resource" "stream" {
  for_each    = local.instances
  rest_api_id = aws_api_gateway_rest_api.poc[each.key].id
  parent_id   = aws_api_gateway_resource.api[each.key].id
  path_part   = "agent-stream-poc"
}
resource "aws_api_gateway_authorizer" "cognito" {
  for_each        = local.instances
  name            = "existing-cognito"
  rest_api_id     = aws_api_gateway_rest_api.poc[each.key].id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.user_pool_arn]
  identity_source = "method.request.header.Authorization"
}
resource "aws_api_gateway_method" "post" {
  for_each             = local.instances
  rest_api_id          = aws_api_gateway_rest_api.poc[each.key].id
  resource_id          = aws_api_gateway_resource.stream[each.key].id
  http_method          = "POST"
  authorization        = "COGNITO_USER_POOLS"
  authorizer_id        = aws_api_gateway_authorizer.cognito[each.key].id
  authorization_scopes = ["raiquora/user"]
}
resource "aws_api_gateway_integration" "stream" {
  for_each                = local.instances
  rest_api_id             = aws_api_gateway_rest_api.poc[each.key].id
  resource_id             = aws_api_gateway_resource.stream[each.key].id
  http_method             = aws_api_gateway_method.post[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.poc[each.key].response_streaming_invoke_arn
  response_transfer_mode  = "STREAM"
  timeout_milliseconds    = 250000
}
resource "aws_lambda_permission" "gateway" {
  for_each      = local.instances
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.poc[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.poc[each.key].execution_arn}/poc/POST/api/agent-stream-poc"
}
resource "aws_api_gateway_deployment" "poc" {
  for_each    = local.instances
  rest_api_id = aws_api_gateway_rest_api.poc[each.key].id
  triggers = { configuration = sha1(jsonencode([
    aws_api_gateway_integration.stream[each.key], aws_api_gateway_method.post[each.key], aws_api_gateway_authorizer.cognito[each.key]
  ])) }
  lifecycle { create_before_destroy = true }
}
resource "aws_api_gateway_stage" "poc" {
  for_each      = local.instances
  rest_api_id   = aws_api_gateway_rest_api.poc[each.key].id
  deployment_id = aws_api_gateway_deployment.poc[each.key].id
  stage_name    = "poc"
}
resource "aws_api_gateway_method_settings" "poc" {
  for_each    = local.instances
  rest_api_id = aws_api_gateway_rest_api.poc[each.key].id
  stage_name  = aws_api_gateway_stage.poc[each.key].stage_name
  method_path = "*/*"
  settings {
    data_trace_enabled     = false
    metrics_enabled        = true
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }
}
resource "aws_cloudfront_distribution" "poc" {
  for_each = local.instances
  enabled  = true
  comment  = "Isolated authenticated Server Agent streaming experiment"
  origin {
    domain_name                 = "${aws_api_gateway_rest_api.poc[each.key].id}.execute-api.${var.region}.amazonaws.com"
    origin_id                   = "regional-rest"
    origin_path                 = "/poc"
    connection_attempts         = 1
    response_completion_timeout = 260
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }
  default_cache_behavior {
    target_origin_id         = "regional-rest"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "413f1600-2a8f-4b94-8d35-0bd57e8a68b3" # Managed-CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
    compress                 = false
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
output "poc_url" {
  value = var.enabled ? "https://${aws_cloudfront_distribution.poc["poc"].domain_name}/api/agent-stream-poc" : null
}
