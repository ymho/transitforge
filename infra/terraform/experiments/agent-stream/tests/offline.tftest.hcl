mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/poc" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn                           = "arn:aws:lambda:ap-northeast-1:123456789012:function:poc"
      response_streaming_invoke_arn = "arn:aws:apigateway:ap-northeast-1:lambda:path/2021-11-15/functions/arn:aws:lambda:ap-northeast-1:123456789012:function:poc/response-streaming-invocations"
    }
  }
  mock_resource "aws_api_gateway_rest_api" {
    defaults = { execution_arn = "arn:aws:execute-api:ap-northeast-1:123456789012:example" }
  }
}
run "disabled_by_default" {
  command = plan
  assert {
    condition     = length(aws_lambda_function.poc) == 0 && length(aws_api_gateway_rest_api.poc) == 0 && length(aws_cloudfront_distribution.poc) == 0
    error_message = "The experiment must not create resources by default."
  }
}
run "streaming_and_auth_contract" {
  command = plan
  variables {
    enabled       = true
    user_pool_arn = "arn:aws:cognito-idp:ap-northeast-1:123456789012:userpool/ap-northeast-1_TestPool"
    user_pool_id  = "ap-northeast-1_TestPool"
    client_id     = "test-client"
    lambda_zip    = "tests/offline.tftest.hcl" # hash input only, mock plan NEVER deploys this as a ZIP
  }
  assert {
    condition     = aws_api_gateway_integration.stream["poc"].response_transfer_mode == "STREAM" && aws_api_gateway_integration.stream["poc"].timeout_milliseconds == 250000
    error_message = "Use streaming integration with a bounded timeout."
  }
  assert {
    condition     = aws_api_gateway_method.post["poc"].authorization == "COGNITO_USER_POOLS" && contains(aws_api_gateway_method.post["poc"].authorization_scopes, "raiquora/user")
    error_message = "Require Cognito Access Token scope."
  }
  assert {
    condition     = aws_lambda_function.poc["poc"].timeout == 240 && length(aws_lambda_function.poc["poc"].vpc_config) == 0
    error_message = "The runtime is bounded and independent from fixed-IP Tool networking."
  }
  assert {
    condition     = aws_cloudfront_distribution.poc["poc"].default_cache_behavior[0].compress == false
    error_message = "Do not introduce compression buffering into the experiment."
  }
}
