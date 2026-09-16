locals {
  trip_changed_name    = "${local.resource_prefix}-trip-changed"
  trip_changed_package = jsondecode(file("${path.module}/../../../packaging/trip-changed.json"))
}

data "archive_file" "trip_changed" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.trip_changed_package.source}"
  output_path = "${path.module}/.terraform/trip-changed.zip"
}
resource "aws_cloudwatch_log_group" "trip_changed" {
  name              = "/aws/lambda/${local.trip_changed_name}"
  retention_in_days = 30
}
resource "aws_iam_role" "trip_changed" {
  name               = local.trip_changed_name
  assume_role_policy = data.aws_iam_policy_document.bedrock_agent_assume_role.json
}

# This SQS DLQ holds wake-up events only. Actual failed TripChanged records remain durable
# in the table's dead#0..3 partitions until an operator explicitly repairs/replays them.
resource "aws_sqs_queue" "trip_changed_tick_dlq" {
  name                      = "${local.trip_changed_name}-tick-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
data "aws_iam_policy_document" "trip_changed_worker" {
  statement {
    sid       = "ReadDeliveryIndex"
    actions   = ["dynamodb:Query"]
    resources = ["${aws_dynamodb_table.trips.arn}/index/trip-changed-due"]
  }
  statement {
    sid       = "ReconcileExistingOwnerScopedTripWatches"
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:ConditionCheckItem"]
    resources = [aws_dynamodb_table.trips.arn]
  }
  statement {
    sid       = "MetricsOnlyLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.trip_changed.arn}:*"]
  }
  statement {
    sid       = "FailedWakeupDestination"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.trip_changed_tick_dlq.arn]
  }
}
resource "aws_iam_role_policy" "trip_changed" {
  role   = aws_iam_role.trip_changed.id
  policy = data.aws_iam_policy_document.trip_changed_worker.json
}
resource "aws_cloudwatch_event_rule" "trip_changed" {
  name                = local.trip_changed_name
  description         = "Drain durable TripChanged outbox; not a per-Trip recheck schedule"
  schedule_expression = "rate(1 minute)"
}
resource "aws_lambda_function" "trip_changed" {
  function_name                  = local.trip_changed_name
  role                           = aws_iam_role.trip_changed.arn
  filename                       = data.archive_file.trip_changed.output_path
  source_code_hash               = data.archive_file.trip_changed.output_base64sha256
  handler                        = local.trip_changed_package.handler
  runtime                        = local.trip_changed_package.runtime
  timeout                        = 90
  memory_size                    = 512
  reserved_concurrent_executions = 1
  environment {
    variables = {
      TRIP_TABLE_NAME       = aws_dynamodb_table.trips.name
      TRIP_CHANGED_RULE_ARN = aws_cloudwatch_event_rule.trip_changed.arn
      RECHECK_TABLE_NAME    = aws_dynamodb_table.trip_rechecks.name
      RECHECK_TARGET_BUCKET = local.recheck_data_bucket
      RECHECK_TARGET_KEY    = local.recheck_target_key
    }
  }
  depends_on = [aws_iam_role_policy.trip_changed, aws_iam_role_policy.trip_changed_rechecks, aws_cloudwatch_log_group.trip_changed]
}
resource "aws_lambda_function_event_invoke_config" "trip_changed" {
  function_name                = aws_lambda_function.trip_changed.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 3600
  destination_config {
    on_failure {
      destination = aws_sqs_queue.trip_changed_tick_dlq.arn
    }
  }
}
resource "aws_lambda_permission" "trip_changed_tick" {
  statement_id  = "OnlyScheduledOutboxPoll"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trip_changed.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.trip_changed.arn
}
data "aws_iam_policy_document" "trip_changed_tick_dlq" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.trip_changed_tick_dlq.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.trip_changed.arn]
    }
  }
}
resource "aws_sqs_queue_policy" "trip_changed_tick_dlq" {
  queue_url = aws_sqs_queue.trip_changed_tick_dlq.id
  policy    = data.aws_iam_policy_document.trip_changed_tick_dlq.json
}
resource "aws_cloudwatch_event_target" "trip_changed" {
  rule = aws_cloudwatch_event_rule.trip_changed.name
  arn  = aws_lambda_function.trip_changed.arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 6
  }
  dead_letter_config {
    arn = aws_sqs_queue.trip_changed_tick_dlq.arn
  }
  depends_on = [aws_lambda_permission.trip_changed_tick, aws_sqs_queue_policy.trip_changed_tick_dlq]
}

# Operator-facing CloudWatch alarms; not user Trip Notifications (#395).
resource "aws_cloudwatch_metric_alarm" "trip_changed_dlq" {
  alarm_name          = "${local.trip_changed_name}-dead-letter"
  namespace           = "Raiquora/TripChanged"
  metric_name         = "DLQ"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "trip_changed_lag" {
  alarm_name          = "${local.trip_changed_name}-projection-lag"
  namespace           = "Raiquora/TripChanged"
  metric_name         = "ProjectionLagMs"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 300000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "trip_changed_heartbeat" {
  alarm_name          = "${local.trip_changed_name}-poll-stopped"
  namespace           = "Raiquora/TripChanged"
  metric_name         = "PollSuccess"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}
resource "aws_cloudwatch_metric_alarm" "trip_changed_tick_dlq" {
  alarm_name          = "${local.trip_changed_name}-tick-dead-letter"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.trip_changed_tick_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
