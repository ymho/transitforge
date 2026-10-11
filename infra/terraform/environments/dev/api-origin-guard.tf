variable "require_cloudfront_origin_key" {
  type        = bool
  default     = true
  description = "Require the server-only CloudFront origin key in addition to Cognito. Set false only during the documented initial two-phase rollout."
}

// API Gateway generates this value. It is never an output or a Browser credential.
resource "aws_api_gateway_api_key" "cloudfront_origin" {
  for_each = local.agent_stream_instances
  name     = "${local.agent_stream_name}-cloudfront-origin"
  enabled  = true
}

resource "aws_api_gateway_usage_plan" "cloudfront_origin" {
  for_each = local.agent_stream_instances
  name     = "${local.agent_stream_name}-cloudfront-origin"
  api_stages {
    api_id = aws_api_gateway_rest_api.agent_stream[each.key].id
    stage  = aws_api_gateway_stage.agent_stream[each.key].stage_name
  }
}

resource "aws_api_gateway_usage_plan_key" "cloudfront_origin" {
  for_each      = local.agent_stream_instances
  key_id        = aws_api_gateway_api_key.cloudfront_origin[each.key].id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.cloudfront_origin[each.key].id
}
