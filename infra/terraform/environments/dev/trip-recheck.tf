# One shared, bounded due-work poller. Never a schedule per Trip.
locals {
  trip_recheck_name    = "${local.resource_prefix}-trip-recheck"
  trip_recheck_package = jsondecode(file("${path.module}/../../../packaging/trip-recheck.json"))
  recheck_target_key   = "runtime/trip-watch-targets-v1.json"
  recheck_data_bucket  = "${local.resource_prefix}-data-builder-source"
}
resource "aws_dynamodb_table" "trip_rechecks" {
  name                        = local.trip_recheck_name
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
    name = "recheckShard"
    type = "S"
  }
  attribute {
    name = "dueAt"
    type = "N"
  }
  global_secondary_index {
    name            = "recheck-due"
    hash_key        = "recheckShard"
    range_key       = "dueAt"
    projection_type = "KEYS_ONLY"
  }
  server_side_encryption { enabled = true }
  point_in_time_recovery { enabled = true }
}
data "archive_file" "trip_recheck" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.trip_recheck_package.source}"
  output_path = "${path.module}/.terraform/trip-recheck.zip"
}
resource "aws_cloudwatch_log_group" "trip_recheck" {
  name              = "/aws/lambda/${local.trip_recheck_name}"
  retention_in_days = 30
}
resource "aws_iam_role" "trip_recheck" {
  name               = local.trip_recheck_name
  assume_role_policy = data.aws_iam_policy_document.bedrock_agent_assume_role.json
}
resource "aws_sqs_queue" "trip_recheck_tick_dlq" {
  name                      = "${local.trip_recheck_name}-tick-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
# Only the durable TripChanged consumer may seed tasks. Agent has no access to this table/catalog.
data "aws_iam_policy_document" "trip_changed_rechecks" {
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.trip_rechecks.arn]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.recheck_data_bucket}/${local.recheck_target_key}"]
  }
}
resource "aws_iam_role_policy" "trip_changed_rechecks" {
  role   = aws_iam_role.trip_changed.id
  policy = data.aws_iam_policy_document.trip_changed_rechecks.json
}
data "aws_iam_policy_document" "trip_recheck" {
  statement {
    actions   = ["dynamodb:Query"]
    resources = ["${aws_dynamodb_table.trip_rechecks.arn}/index/recheck-due", "${aws_dynamodb_table.trips.arn}/index/rail-watch-routing", "${aws_dynamodb_table.trips.arn}/index/watch-subject"]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.trip_rechecks.arn]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:ConditionCheckItem"]
    resources = [aws_dynamodb_table.trips.arn]
  }
  # Watch projection and Impact only. No Trip/Reservation/Checklist attributes permitted.
  statement {
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
      values   = ["pk", "sk", "storageVersion", "impact", "impactId", "watch", "active", "sourceTripRevision", "version", "complete", "watchSubject", "railSubject"]
    }
    condition {
      test     = "Null"
      variable = "dynamodb:Attributes"
      values   = ["false"]
    }
  }
  statement {
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::${local.recheck_data_bucket}/timetable/normalized/*/direct-service-index.json.gz",
      "arn:aws:s3:::${local.recheck_data_bucket}/${local.recheck_target_key}",
      "${aws_s3_bucket.website.arn}/api/traffic/delays.json",
    ]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.trip_recheck.arn}:*"]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.trip_recheck_tick_dlq.arn]
  }
}
resource "aws_iam_role_policy" "trip_recheck" {
  role   = aws_iam_role.trip_recheck.id
  policy = data.aws_iam_policy_document.trip_recheck.json
}
resource "aws_cloudwatch_event_rule" "trip_recheck" {
  name                = local.trip_recheck_name
  schedule_expression = "rate(1 minute)"
}
resource "aws_lambda_function" "trip_recheck" {
  function_name                  = local.trip_recheck_name
  role                           = aws_iam_role.trip_recheck.arn
  filename                       = data.archive_file.trip_recheck.output_path
  source_code_hash               = data.archive_file.trip_recheck.output_base64sha256
  handler                        = local.trip_recheck_package.handler
  runtime                        = local.trip_recheck_package.runtime
  timeout                        = 180
  memory_size                    = 512
  reserved_concurrent_executions = 1
  environment {
    variables = {
      TRIP_TABLE_NAME           = aws_dynamodb_table.trips.name
      RECHECK_TABLE_NAME        = aws_dynamodb_table.trip_rechecks.name
      NOTIFICATION_TABLE_NAME   = aws_dynamodb_table.trip_notifications.name
      RECHECK_RULE_ARN          = aws_cloudwatch_event_rule.trip_recheck.arn
      RECHECK_TARGET_BUCKET     = local.recheck_data_bucket
      RECHECK_TARGET_KEY        = local.recheck_target_key
      AI_TIMETABLE_BUCKET       = local.recheck_data_bucket
      PLANNING_TIMETABLE_PREFIX = "timetable"
      TRAFFIC_SNAPSHOT_BUCKET   = aws_s3_bucket.website.id
      TRAFFIC_SNAPSHOT_KEY      = "api/traffic/delays.json"
    }
  }
  depends_on = [aws_iam_role_policy.trip_recheck, aws_cloudwatch_log_group.trip_recheck, aws_iam_role_policy.impact_notification_signal]
}
resource "aws_lambda_function_event_invoke_config" "trip_recheck" {
  function_name                = aws_lambda_function.trip_recheck.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 3600
  destination_config {
    on_failure { destination = aws_sqs_queue.trip_recheck_tick_dlq.arn }
  }
}
resource "aws_lambda_permission" "trip_recheck_tick" {
  statement_id  = "OnlySharedRecheckTick"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trip_recheck.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.trip_recheck.arn
}
data "aws_iam_policy_document" "trip_recheck_tick_dlq" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.trip_recheck_tick_dlq.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.trip_recheck.arn]
    }
  }
}
resource "aws_sqs_queue_policy" "trip_recheck_tick_dlq" {
  queue_url = aws_sqs_queue.trip_recheck_tick_dlq.id
  policy    = data.aws_iam_policy_document.trip_recheck_tick_dlq.json
}
resource "aws_cloudwatch_event_target" "trip_recheck" {
  rule = aws_cloudwatch_event_rule.trip_recheck.name
  arn  = aws_lambda_function.trip_recheck.arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 6
  }
  dead_letter_config { arn = aws_sqs_queue.trip_recheck_tick_dlq.arn }
  depends_on = [aws_lambda_permission.trip_recheck_tick, aws_sqs_queue_policy.trip_recheck_tick_dlq]
}
resource "aws_cloudwatch_metric_alarm" "trip_recheck" {
  for_each            = { DLQ = 0, RecheckLagMs = 300000, ProviderFailure = 10 }
  alarm_name          = "${local.trip_recheck_name}-${each.key}"
  namespace           = "Raiquora/TripRecheck"
  metric_name         = each.key
  statistic           = each.key == "RecheckLagMs" ? "Maximum" : "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "trip_recheck_heartbeat" {
  alarm_name          = "${local.trip_recheck_name}-poll-stopped"
  namespace           = "Raiquora/TripRecheck"
  metric_name         = "PollSuccess"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}
resource "aws_cloudwatch_metric_alarm" "trip_recheck_tick_dlq" {
  alarm_name          = "${local.trip_recheck_name}-tick-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.trip_recheck_tick_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
