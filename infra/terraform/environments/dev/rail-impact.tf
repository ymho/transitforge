# IAM-invoked internal seam; no HTTP endpoint, Agent invocation grant, polling or per-Trip timer.
locals {
  rail_impact_name    = "${local.resource_prefix}-rail-impact"
  rail_impact_package = jsondecode(file("${path.module}/../../../packaging/rail-impact.json"))
}
data "archive_file" "rail_impact" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.rail_impact_package.source}"
  output_path = "${path.module}/.terraform/rail-impact.zip"
}
resource "aws_cloudwatch_log_group" "rail_impact" {
  name              = "/aws/lambda/${local.rail_impact_name}"
  retention_in_days = 30
}
resource "aws_iam_role" "rail_impact" {
  name               = local.rail_impact_name
  assume_role_policy = data.aws_iam_policy_document.bedrock_agent_assume_role.json
}
data "aws_iam_policy_document" "rail_impact" {
  statement {
    sid       = "InternalRailRoutingOnly"
    actions   = ["dynamodb:Query"]
    resources = ["${aws_dynamodb_table.trips.arn}/index/rail-watch-routing", "${aws_dynamodb_table.trips.arn}/index/watch-subject"]
  }
  statement {
    sid       = "ReadOwnerResourcesAndFenceTrip"
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:ConditionCheckItem"]
    resources = [aws_dynamodb_table.trips.arn]
  }
  statement {
    sid       = "WriteImpactEnvelopeOnly"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.trips.arn]
    condition {
      test     = "ForAnyValue:StringEquals"
      variable = "dynamodb:EnclosingOperation"
      values   = ["TransactWriteItems"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:Attributes"
      values   = ["pk", "sk", "storageVersion", "impact", "impactId"]
    }
    condition {
      test     = "Null"
      variable = "dynamodb:Attributes"
      values   = ["false"]
    }
  }
  statement {
    sid       = "MetricsOnlyLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.rail_impact.arn}:*"]
  }
}
resource "aws_iam_role_policy" "rail_impact" {
  role   = aws_iam_role.rail_impact.id
  policy = data.aws_iam_policy_document.rail_impact.json
}
resource "aws_lambda_function" "rail_impact" {
  function_name                  = local.rail_impact_name
  role                           = aws_iam_role.rail_impact.arn
  filename                       = data.archive_file.rail_impact.output_path
  source_code_hash               = data.archive_file.rail_impact.output_base64sha256
  handler                        = local.rail_impact_package.handler
  runtime                        = local.rail_impact_package.runtime
  timeout                        = 120
  memory_size                    = 512
  reserved_concurrent_executions = 2
  environment {
    variables = { TRIP_TABLE_NAME = aws_dynamodb_table.trips.name }
  }
  depends_on = [aws_iam_role_policy.rail_impact, aws_cloudwatch_log_group.rail_impact]
}
# Internal host must use RequestResponse and inspect failed/replayRequired. No lossy async success receipt.
resource "aws_cloudwatch_metric_alarm" "rail_impact_failure" {
  alarm_name          = "${local.rail_impact_name}-failure"
  namespace           = "Raiquora/RailImpact"
  metric_name         = "EvaluationFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
