locals {
  bedrock_agent_function_name = "${var.project_name}-${var.environment}-bedrock-agent"
  bedrock_model_ids = toset(compact([
    var.bedrock_model_id,
    var.bedrock_lightweight_model_id,
    var.bedrock_decision_model_id,
  ]))
  bedrock_inference_profile_ids = toset([
    for model_id in local.bedrock_model_ids : model_id
    if startswith(model_id, "jp.") || startswith(model_id, "apac.") ||
    startswith(model_id, "global.")
  ])
  bedrock_foundation_model_ids = setsubtract(
    local.bedrock_model_ids,
    local.bedrock_inference_profile_ids,
  )
  bedrock_inference_profile_model_ids = toset([
    for profile_id in local.bedrock_inference_profile_ids :
    replace(profile_id, "/^[^.]+\\./", "")
  ])
  bedrock_agent_package = jsondecode(
    file("${path.module}/../../../packaging/agent-api.json")
  )
}

data "archive_file" "bedrock_agent" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.bedrock_agent_package.source}"
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

resource "aws_s3_bucket" "conversation_feedback" {
  bucket = "${local.resource_prefix}-conversation-feedback"
}
resource "aws_s3_bucket_public_access_block" "conversation_feedback" {
  bucket                  = aws_s3_bucket.conversation_feedback.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_lifecycle_configuration" "conversation_feedback" {
  bucket = aws_s3_bucket.conversation_feedback.id

  rule {
    id     = "expire-feedback"
    status = "Enabled"

    filter {
      prefix = "conversation-feedback/"
    }

    expiration {
      days = 90
    }
  }

  rule {
    id     = "expire-agent-traces"
    status = "Enabled"

    filter {
      prefix = "agent-traces/"
    }

    expiration {
      days = 30
    }
  }
}

data "aws_iam_policy_document" "bedrock_agent" {
  statement {
    sid     = "InvokeSelectedModel"
    actions = ["bedrock:InvokeModel"]
    resources = concat(
      [for model_id in local.bedrock_foundation_model_ids :
        "arn:aws:bedrock:${var.aws_region}::foundation-model/${model_id}"
      ],
      [for profile_id in local.bedrock_inference_profile_ids :
        "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${profile_id}"
      ],
      [for model_id in local.bedrock_inference_profile_model_ids :
        "arn:aws:bedrock:*::foundation-model/${model_id}"
      ],
    )
  }
  statement {
    sid     = "WritePrivateAgentRecords"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.conversation_feedback.arn}/conversation-feedback/*",
      "${aws_s3_bucket.conversation_feedback.arn}/agent-traces/*",
    ]
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
    sid     = "ReadRepresentativeTimetables"
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::${local.resource_prefix}-data-builder-source/ai-timetable/*",
      "arn:aws:s3:::${local.resource_prefix}-data-builder-source/timetable/normalized/*",
      "${aws_s3_bucket.website.arn}/api/traffic/delays.json",
    ]
  }

  statement {
    sid       = "ReadTravelProviderCredentials"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.travel_provider.arn]
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

resource "aws_iam_role_policy_attachment" "bedrock_agent_vpc_access" {
  role       = aws_iam_role.bedrock_agent.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "bedrock_agent" {
  function_name = local.bedrock_agent_function_name
  description   = "Relay validated TransitForge tool conversations to Amazon Bedrock"
  role          = aws_iam_role.bedrock_agent.arn
  runtime       = local.bedrock_agent_package.runtime
  architectures = ["arm64"]
  handler       = local.bedrock_agent_package.handler

  filename         = data.archive_file.bedrock_agent.output_path
  source_code_hash = data.archive_file.bedrock_agent.output_base64sha256

  memory_size = 512
  timeout     = 60

  vpc_config {
    subnet_ids         = [aws_subnet.ai_egress_private.id]
    security_group_ids = [aws_security_group.ai_lambda.id]
  }

  environment {
    variables = {
      MODEL_ID                     = var.bedrock_model_id
      LIGHTWEIGHT_MODEL_ID         = var.bedrock_lightweight_model_id
      DECISION_MODEL_ID            = var.bedrock_decision_model_id
      SUMMARY_TABLE                = aws_dynamodb_table.train_congestion_summary.name
      DELAY_SUMMARY_TABLE          = aws_dynamodb_table.train_delay_summary.name
      AI_TIMETABLE_BUCKET          = "${local.resource_prefix}-data-builder-source"
      AI_TIMETABLE_PREFIX          = "ai-timetable"
      PLANNING_TIMETABLE_PREFIX    = "timetable"
      TRAFFIC_SNAPSHOT_BUCKET      = aws_s3_bucket.website.id
      TRAFFIC_SNAPSHOT_KEY         = "api/traffic/delays.json"
      TRAVEL_PROVIDER_SECRET_ARN   = aws_secretsmanager_secret.travel_provider.arn
      VIEWER_ORIGIN                = "https://${var.viewer_domain_name}"
      CONVERSATION_FEEDBACK_BUCKET = aws_s3_bucket.conversation_feedback.id
      AGENT_TRACE_BUCKET           = aws_s3_bucket.conversation_feedback.id
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.bedrock_agent,
    aws_iam_role_policy.bedrock_agent,
    aws_iam_role_policy_attachment.bedrock_agent_vpc_access,
    aws_eip_association.ai_nat,
  ]
}

resource "aws_lambda_function_url" "ai_agent" {
  function_name      = aws_lambda_function.bedrock_agent.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "cloudfront_function_url" {
  count = var.legacy_cloudfront_redirect_enabled ? 0 : 1

  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.bedrock_agent.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.website.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke_function" {
  count = var.legacy_cloudfront_redirect_enabled ? 0 : 1

  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.bedrock_agent.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.website.arn
  invoked_via_function_url = true
}

resource "aws_lambda_permission" "viewer_cloudfront_function_url" {
  count = var.cloudflare_front_door_enabled ? 1 : 0

  statement_id           = "AllowViewerCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.bedrock_agent.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.viewer[0].arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "viewer_cloudfront_invoke_function" {
  count = var.cloudflare_front_door_enabled ? 1 : 0

  statement_id             = "AllowViewerCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.bedrock_agent.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.viewer[0].arn
  invoked_via_function_url = true
}
