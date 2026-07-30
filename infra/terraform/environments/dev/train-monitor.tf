locals {
  train_monitor_archive_bucket = "${local.resource_prefix}-train-monitor-archive"
  train_monitor_latest_key     = "api/westjr/trainmonitorinfo.json"
  train_monitor_upstream_url   = "https://www.train-guide.westjr.co.jp/api/v3/trainmonitorinfo.json"
  train_congestion_summary     = "${var.project_name}-${var.environment}-train-congestion-summary"
}

data "archive_file" "train_monitor_collector" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/train_monitor_collector"
  output_path = "${path.module}/.terraform/train-monitor-collector.zip"
}

resource "aws_s3_bucket" "train_monitor_archive" {
  bucket = local.train_monitor_archive_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "train_monitor_archive" {
  bucket = aws_s3_bucket.train_monitor_archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "train_monitor_archive" {
  bucket = aws_s3_bucket.train_monitor_archive.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "train_monitor_archive" {
  bucket = aws_s3_bucket.train_monitor_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }

}

resource "aws_s3_bucket_lifecycle_configuration" "train_monitor_archive" {
  bucket = aws_s3_bucket.train_monitor_archive.id

  rule {
    id     = "expire-old-train-monitor-snapshots"
    status = "Enabled"

    filter {
      prefix = "raw/"
    }

    expiration {
      days = var.train_monitor_archive_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-collection-claims"
    status = "Enabled"

    filter {
      prefix = "claims/"
    }

    expiration {
      days = 2
    }
  }
}

resource "aws_dynamodb_table" "train_congestion_summary" {
  name         = local.train_congestion_summary
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "serviceDate"
  range_key    = "collectedAt"

  attribute {
    name = "serviceDate"
    type = "S"
  }

  attribute {
    name = "collectedAt"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }
}

data "aws_iam_policy_document" "train_monitor_collector_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "train_monitor_collector" {
  name               = "${var.project_name}-${var.environment}-train-monitor-collector"
  assume_role_policy = data.aws_iam_policy_document.train_monitor_collector_assume_role.json
}

resource "aws_cloudwatch_log_group" "train_monitor_collector" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-train-monitor-collector"
  retention_in_days = 30
}

data "aws_iam_policy_document" "train_monitor_collector" {
  statement {
    sid = "WriteSnapshots"

    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.train_monitor_archive.arn}/claims/*",
      "${aws_s3_bucket.train_monitor_archive.arn}/raw/*",
      "${aws_s3_bucket.website.arn}/${local.train_monitor_latest_key}",
    ]
  }

  statement {
    sid = "ReadRawSnapshotsForBackfill"

    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.train_monitor_archive.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["raw/*"]
    }
  }

  statement {
    sid       = "ReadRawSnapshotObjectsForBackfill"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.train_monitor_archive.arn}/raw/*"]
  }

  statement {
    sid       = "WriteCongestionSummaries"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.train_congestion_summary.arn]
  }

  statement {
    sid = "WriteLogs"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.train_monitor_collector.arn}:*"]
  }
}

resource "aws_iam_role_policy" "train_monitor_collector" {
  name   = "collect-and-store-train-monitor-snapshots"
  role   = aws_iam_role.train_monitor_collector.id
  policy = data.aws_iam_policy_document.train_monitor_collector.json
}

resource "aws_lambda_function" "train_monitor_collector" {
  function_name = "${var.project_name}-${var.environment}-train-monitor-collector"
  description   = "Fetch one JR West train monitor snapshot per scheduled invocation"
  role          = aws_iam_role.train_monitor_collector.arn
  runtime       = "python3.12"
  architectures = ["arm64"]
  handler       = "handler.lambda_handler"

  filename         = data.archive_file.train_monitor_collector.output_path
  source_code_hash = data.archive_file.train_monitor_collector.output_base64sha256

  memory_size = 256
  timeout     = 60

  environment {
    variables = {
      ARCHIVE_BUCKET = aws_s3_bucket.train_monitor_archive.id
      LATEST_BUCKET  = aws_s3_bucket.website.id
      LATEST_KEY     = local.train_monitor_latest_key
      SUMMARY_TABLE  = aws_dynamodb_table.train_congestion_summary.name
      SUMMARY_RETENTION_DAYS = tostring(
        var.train_monitor_archive_retention_days
      )
      UPSTREAM_URL = local.train_monitor_upstream_url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.train_monitor_collector,
    aws_iam_role_policy.train_monitor_collector,
  ]
}

data "aws_iam_policy_document" "train_monitor_scheduler_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "train_monitor_scheduler" {
  name               = "${var.project_name}-${var.environment}-train-monitor-scheduler"
  assume_role_policy = data.aws_iam_policy_document.train_monitor_scheduler_assume_role.json
}

data "aws_iam_policy_document" "train_monitor_scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.train_monitor_collector.arn]
  }
}

resource "aws_iam_role_policy" "train_monitor_scheduler" {
  name   = "invoke-train-monitor-collector"
  role   = aws_iam_role.train_monitor_scheduler.id
  policy = data.aws_iam_policy_document.train_monitor_scheduler.json
}

resource "aws_scheduler_schedule" "train_monitor_collector" {
  name                         = "${var.project_name}-${var.environment}-train-monitor-every-minute"
  description                  = "Collect one JR West train monitor snapshot every minute"
  schedule_expression          = "rate(1 minute)"
  schedule_expression_timezone = "Asia/Tokyo"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.train_monitor_collector.arn
    role_arn = aws_iam_role.train_monitor_scheduler.arn
    input    = jsonencode({ source = "transitforge.scheduler" })

    retry_policy {
      maximum_event_age_in_seconds = 60
      maximum_retry_attempts       = 0
    }
  }

  depends_on = [aws_iam_role_policy.train_monitor_scheduler]
}
