# Offline only. All AWS/archive providers are mocked; no account credentials or resources.
mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_availability_zones" { defaults = { names = ["ap-northeast-1a"] } }
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
  mock_data "aws_ssm_parameter" { defaults = { value = "ami-0123456789abcdef0" } }
}
mock_provider "aws" { alias = "us_east_1" }
mock_provider "archive" {}
variables {
  basic_auth_credentials_sha256    = "0000000000000000000000000000000000000000000000000000000000000000"
  github_repository                = "example/transitforge"
  data_builder_github_oidc_subject = "repo:example@12345/transitforge-data-builder@67890:environment:dev"
}
override_resource {
  override_during = plan
  target          = aws_cognito_resource_server.api
  values          = { scope_identifiers = ["raiquora/user"] }
}
override_resource {
  target          = aws_api_gateway_rest_api.agent_stream["stream"]
  override_during = plan
  values          = { id = "stream-api", execution_arn = "arn:aws:execute-api:ap-northeast-1:123456789012:stream-api" }
}
override_resource {
  target          = aws_lambda_function.agent_stream["stream"]
  override_during = plan
  values          = { response_streaming_invoke_arn = "arn:aws:apigateway:ap-northeast-1:lambda:path/2021-11-15/functions/arn:aws:lambda:ap-northeast-1:123456789012:function:stream/response-streaming-invocations" }
}
run "default_off" {
  command = plan
  assert {
    condition     = length(aws_lambda_function.agent_stream) == 0 && length(aws_api_gateway_rest_api.agent_stream) == 0 && length(aws_api_gateway_account.agent_stream) == 0
    error_message = "The temporary gate must create no streaming resources by default."
  }
  assert {
    condition     = length([for b in aws_cloudfront_distribution.website.ordered_cache_behavior : b if b.path_pattern == "/api/agent-stream"]) == 0 && length([for b in aws_cloudfront_distribution.website.ordered_cache_behavior : b if b.path_pattern == "/api/agent"]) == 1
    error_message = "Default-off must leave the old Browser route intact."
  }
}
run "enabled_contract" {
  command = plan
  variables {
    agent_stream_enabled         = true
    enable_fixed_egress_provider = true
  }
  assert {
    condition     = aws_lambda_function.agent_stream["stream"].environment[0].variables.SERVER_AGENT_MAX_EXECUTION_MS == "120000"
    error_message = "Production must explicitly supply its business budget, not inherit the shared 15s default."
  }
  assert {
    condition     = aws_lambda_function.agent_stream["stream"].environment[0].variables.SERVER_STATE_TABLE_NAME == aws_dynamodb_table.server_state.name && aws_lambda_function.agent_stream["stream"].environment[0].variables.TRIP_TABLE_NAME == aws_dynamodb_table.trips.name
    error_message = "The authenticated stateful composition must use the existing State and Trip tables."
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.agent_stream["stream"].environment[0].variables), "TRAVEL_PROVIDER_SECRET_ARN") && length(aws_iam_role_policy.agent_stream_provider_invoke) == 1 && length(aws_secretsmanager_secret.agent_stream_providers) == 1
    error_message = "The Runtime must invoke the dedicated Provider and never receive the mixed Travel secret."
  }
  assert {
    condition     = aws_api_gateway_integration.agent_stream_route["stream"].uri == aws_lambda_function.agent_stream["stream"].response_streaming_invoke_arn && aws_lambda_permission.agent_stream_gateway["stream"].source_arn == "arn:aws:execute-api:ap-northeast-1:123456789012:stream-api/dev/POST/api/agent-stream"
    error_message = "Use the streaming invoke ARN and exact API/stage/POST/path permission."
  }
  assert {
    condition     = length([for b in aws_cloudfront_distribution.website.ordered_cache_behavior : b if b.path_pattern == "/api/agent-stream"]) == 1 && length([for b in aws_cloudfront_distribution.website.ordered_cache_behavior : b if b.path_pattern == "/api/agent"]) == 1
    error_message = "The opt-in route must coexist with the unchanged Browser route until cutover."
  }
  assert {
    condition     = aws_api_gateway_integration.agent_stream_route["stream"].response_transfer_mode == "STREAM" && aws_api_gateway_integration.agent_stream_route["stream"].timeout_milliseconds == 250000 && aws_api_gateway_integration.agent_stream_route["stream"].type == "AWS_PROXY"
    error_message = "The REST route must use bounded streaming."
  }
  assert {
    condition     = aws_api_gateway_method.agent_stream_post["stream"].authorization == "COGNITO_USER_POOLS" && contains(aws_api_gateway_method.agent_stream_post["stream"].authorization_scopes, "raiquora/user")
    error_message = "Every invoke path, including direct execute-api, must require Cognito and scope."
  }
  assert {
    condition     = aws_lambda_function.agent_stream["stream"].timeout == 240 && length(aws_lambda_function.agent_stream["stream"].vpc_config) == 0 && aws_lambda_function.agent_stream["stream"].environment[0].variables.AGENT_STREAM_PATH == "/api/agent-stream"
    error_message = "Keep the Agent out of VPC and use the route contract in its composition."
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.website.ordered_cache_behavior : !b.compress && length(b.function_association) == 0 && b.cache_policy_id == data.aws_cloudfront_cache_policy.caching_disabled.id && b.origin_request_policy_id == data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id if b.path_pattern == "/api/agent-stream"])
    error_message = "Streaming must not buffer compression or run Basic auth on the Bearer header."
  }
  assert {
    condition     = alltrue([for o in aws_cloudfront_distribution.website.origin : o.response_completion_timeout == 260 && o.connection_attempts == 1 && one(o.custom_origin_config).origin_read_timeout == 60 if o.origin_id == local.agent_stream_name])
    error_message = "CloudFront timeouts must follow ADR 0070."
  }
  assert {
    condition     = aws_api_gateway_method_settings.agent_stream["stream"].settings[0].data_trace_enabled == false && aws_api_gateway_method_settings.agent_stream["stream"].settings[0].metrics_enabled && aws_api_gateway_method_settings.agent_stream["stream"].settings[0].logging_level == "OFF"
    error_message = "Metrics must not enable body/token execution logging."
  }
  assert {
    condition     = aws_iam_role.agent_stream_gateway_logs["stream"].assume_role_policy == jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "apigateway.amazonaws.com" }, Action = "sts:AssumeRole" }] }) && aws_iam_role_policy_attachment.agent_stream_gateway_logs["stream"].policy_arn == "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
    error_message = "The API Gateway account role must retain the API Gateway trust and AWS managed CloudWatch Logs policy."
  }
}
run "custom_domain_contract" {
  command = plan
  variables {
    enable_fixed_egress_provider       = true
    agent_stream_enabled               = true
    cloudflare_front_door_enabled      = true
    legacy_cloudfront_redirect_enabled = true
    environment                        = "prod"
  }
  assert {
    condition     = length([for b in aws_cloudfront_distribution.website.ordered_cache_behavior : b if b.path_pattern == "/api/agent-stream"]) == 0 && length([for b in aws_cloudfront_distribution.viewer[0].ordered_cache_behavior : b if b.path_pattern == "/api/agent-stream"]) == 1 && length([for b in aws_cloudfront_distribution.viewer[0].ordered_cache_behavior : b if b.path_pattern == "/api/agent"]) == 1
    error_message = "Use the active custom-domain distribution without replacing the Browser route."
  }
  assert {
    condition     = aws_api_gateway_stage.agent_stream["stream"].stage_name == "prod" && alltrue([for o in aws_cloudfront_distribution.viewer[0].origin : o.origin_path == "/prod" && o.response_completion_timeout == 260 && one(o.custom_origin_config).origin_read_timeout == 60 if o.origin_id == local.agent_stream_name])
    error_message = "The environment stage and CloudFront origin must match."
  }
}
run "custom_domain_default_off" {
  command = plan
  variables {
    cloudflare_front_door_enabled      = true
    legacy_cloudfront_redirect_enabled = true
  }
  assert {
    condition     = length(aws_lambda_function.agent_stream) == 0 && length(aws_api_gateway_rest_api.agent_stream) == 0 && length([for b in aws_cloudfront_distribution.viewer[0].ordered_cache_behavior : b if b.path_pattern == "/api/agent-stream"]) == 0 && length([for b in aws_cloudfront_distribution.viewer[0].ordered_cache_behavior : b if b.path_pattern == "/api/agent"]) == 1
    error_message = "The current custom-domain production topology must also remain default-off."
  }
}

run "stream_requires_provider" {
  command = plan
  variables {
    agent_stream_enabled         = true
    enable_fixed_egress_provider = false
  }
  expect_failures = [aws_lambda_function.agent_stream["stream"]]
}

run "custom_business_deadline" {
  command = plan
  variables {
    agent_stream_enabled          = true
    enable_fixed_egress_provider  = true
    server_agent_max_execution_ms = 180000
  }
  assert {
    condition     = aws_lambda_function.agent_stream["stream"].environment[0].variables.SERVER_AGENT_MAX_EXECUTION_MS == "180000" && aws_lambda_function.agent_stream["stream"].timeout == 240
    error_message = "Business budget must remain separate from Lambda timeout."
  }
}
run "reject_transport_sized_business_deadline" {
  command = plan
  variables { server_agent_max_execution_ms = 240000 }
  expect_failures = [var.server_agent_max_execution_ms]
}
run "reject_fractional_business_deadline" {
  command = plan
  variables { server_agent_max_execution_ms = 120000.5 }
  expect_failures = [var.server_agent_max_execution_ms]
}
