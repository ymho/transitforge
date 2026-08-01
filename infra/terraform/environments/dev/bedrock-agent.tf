locals {
  bedrock_agent_function_name = "${var.project_name}-${var.environment}-bedrock-agent"
}

data "archive_file" "bedrock_agent" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/bedrock_agent"
  output_path = "${path.module}/.terraform/bedrock-agent.zip"
}

data "aws_iam_policy_document" "bedrock_agent_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bedrock_agent" {
  name               = local.bedrock_agent_function_name
  assume_role_policy = data.aws_iam_policy_document.bedrock_agent_assume_role.json
}

resource "aws_cloudwatch_log_group" "bedrock_agent" {
  name              = "/aws/lambda/${local.bedrock_agent_function_name}"
  retention_in_days = 30
}

data "aws_iam_policy_document" "bedrock_agent" {
  statement {
    sid       = "InvokeSelectedModel"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.aws_region}::foundation-model/${var.bedrock_model_id}"]
  }

  statement {
    sid     = "ReadTrainSummaries"
    actions = ["dynamodb:Query"]
    resources = [
      aws_dynamodb_table.train_congestion_summary.arn,
      aws_dynamodb_table.train_delay_summary.arn,
    ]
  }

  statement {
    sid = "WriteLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.bedrock_agent.arn}:*"]
  }
}

resource "aws_iam_role_policy" "bedrock_agent" {
  name   = "invoke-selected-bedrock-model"
  role   = aws_iam_role.bedrock_agent.id
  policy = data.aws_iam_policy_document.bedrock_agent.json
}

resource "aws_lambda_function" "bedrock_agent" {
  function_name = local.bedrock_agent_function_name
  description   = "Relay validated TransitForge tool conversations to Amazon Bedrock"
  role          = aws_iam_role.bedrock_agent.arn
  runtime       = "python3.12"
  architectures = ["arm64"]
  handler       = "handler.lambda_handler"

  filename         = data.archive_file.bedrock_agent.output_path
  source_code_hash = data.archive_file.bedrock_agent.output_base64sha256

  memory_size = 256
  timeout     = 30

  environment {
    variables = {
      MODEL_ID            = var.bedrock_model_id
      SUMMARY_TABLE       = aws_dynamodb_table.train_congestion_summary.name
      DELAY_SUMMARY_TABLE = aws_dynamodb_table.train_delay_summary.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.bedrock_agent,
    aws_iam_role_policy.bedrock_agent,
  ]
}

resource "aws_lambda_function_url" "ai_agent" {
  function_name      = aws_lambda_function.bedrock_agent.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "cloudfront_function_url" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.bedrock_agent.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.website.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke_function" {
  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.bedrock_agent.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.website.arn
  invoked_via_function_url = true
}
