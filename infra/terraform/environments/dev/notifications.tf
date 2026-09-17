# One shared bounded worker, durable transaction outbox and in-app channel. No Push keys/public trigger.
locals {
  notification_name    = "${local.resource_prefix}-notification"
  notification_package = jsondecode(file("${path.module}/../../../packaging/notification.json"))
}
resource "aws_dynamodb_table" "trip_notifications" {
  name                        = local.notification_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "workShard"
    type = "S"
  }
  attribute {
    name = "availableAt"
    type = "N"
  }
  global_secondary_index {
    name            = "notification-due"
    hash_key        = "workShard"
    range_key       = "availableAt"
    projection_type = "KEYS_ONLY"
  }
  server_side_encryption { enabled = true }
  point_in_time_recovery { enabled = true }
}
# Impact producers may atomically update only the signal envelope, not Notification/read/delivery state.
data "aws_iam_policy_document" "impact_notification_signal" {
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.trip_notifications.arn]
    condition {
      test     = "ForAnyValue:StringEquals"
      variable = "dynamodb:EnclosingOperation"
      values   = ["TransactWriteItems"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:Attributes"
      values   = ["pk", "sk", "storageVersion", "workKind", "observation", "sourceTripRevision", "observationOrder", "workVersion", "attempts", "workState", "workShard", "availableAt"]
    }
    condition {
      test     = "Null"
      variable = "dynamodb:Attributes"
      values   = ["false"]
    }
  }
}
resource "aws_iam_role_policy" "impact_notification_signal" {
  for_each = { rail = aws_iam_role.rail_impact.id, recheck = aws_iam_role.trip_recheck.id }
  role     = each.value
  policy   = data.aws_iam_policy_document.impact_notification_signal.json
}
data "archive_file" "notification" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.notification_package.source}"
  output_path = "${path.module}/.terraform/notification.zip"
}
resource "aws_cloudwatch_log_group" "notification" {
  name              = "/aws/lambda/${local.notification_name}"
  retention_in_days = 30
}
resource "aws_iam_role" "notification" {
  name               = local.notification_name
  assume_role_policy = data.aws_iam_policy_document.bedrock_agent_assume_role.json
}
resource "aws_sqs_queue" "notification_tick_dlq" {
  name                      = "${local.notification_name}-tick-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
data "aws_iam_policy_document" "notification" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.trip_notifications.arn]
  }
  statement {
    actions   = ["dynamodb:Query"]
    resources = ["${aws_dynamodb_table.trip_notifications.arn}/index/notification-due"]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:ConditionCheckItem"]
    resources = [aws_dynamodb_table.trips.arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.notification.arn}:*"]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.notification_tick_dlq.arn]
  }
}
resource "aws_iam_role_policy" "notification" {
  role   = aws_iam_role.notification.id
  policy = data.aws_iam_policy_document.notification.json
}
resource "aws_cloudwatch_event_rule" "notification" {
  name                = local.notification_name
  schedule_expression = "rate(1 minute)"
}
resource "aws_lambda_function" "notification" {
  function_name                  = local.notification_name
  role                           = aws_iam_role.notification.arn
  filename                       = data.archive_file.notification.output_path
  source_code_hash               = data.archive_file.notification.output_base64sha256
  handler                        = local.notification_package.handler
  runtime                        = local.notification_package.runtime
  timeout                        = 180
  memory_size                    = 512
  reserved_concurrent_executions = 1
  environment {
    variables = {
      TRIP_TABLE_NAME         = aws_dynamodb_table.trips.name
      NOTIFICATION_TABLE_NAME = aws_dynamodb_table.trip_notifications.name
      NOTIFICATION_RULE_ARN   = aws_cloudwatch_event_rule.notification.arn
    }
  }
  depends_on = [aws_iam_role_policy.notification, aws_cloudwatch_log_group.notification]
}
resource "aws_lambda_function_event_invoke_config" "notification" {
  function_name                = aws_lambda_function.notification.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 3600
  destination_config {
    on_failure { destination = aws_sqs_queue.notification_tick_dlq.arn }
  }
}
resource "aws_lambda_permission" "notification_tick" {
  statement_id  = "OnlySharedNotificationTick"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notification.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.notification.arn
}
data "aws_iam_policy_document" "notification_tick_dlq" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.notification_tick_dlq.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.notification.arn]
    }
  }
}
resource "aws_sqs_queue_policy" "notification_tick_dlq" {
  queue_url = aws_sqs_queue.notification_tick_dlq.id
  policy    = data.aws_iam_policy_document.notification_tick_dlq.json
}
resource "aws_cloudwatch_event_target" "notification" {
  rule = aws_cloudwatch_event_rule.notification.name
  arn  = aws_lambda_function.notification.arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 6
  }
  dead_letter_config { arn = aws_sqs_queue.notification_tick_dlq.arn }
  depends_on = [aws_lambda_permission.notification_tick, aws_sqs_queue_policy.notification_tick_dlq]
}
resource "aws_cloudwatch_metric_alarm" "notification" {
  for_each            = { DLQ = 0, DeliveryLatencyMs = 300000, Failed = 10 }
  alarm_name          = "${local.notification_name}-${each.key}"
  namespace           = "Raiquora/Notification"
  metric_name         = each.key
  statistic           = each.key == "DeliveryLatencyMs" ? "Maximum" : "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "notification_heartbeat" {
  alarm_name          = "${local.notification_name}-poll-stopped"
  namespace           = "Raiquora/Notification"
  metric_name         = "PollSuccess"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}
resource "aws_cloudwatch_metric_alarm" "notification_tick_dlq" {
  alarm_name          = "${local.notification_name}-tick-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.notification_tick_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
