locals {
  train_delay_archive_bucket = "${local.resource_prefix}-train-delay-archive"
  train_delay_latest_key     = "api/westjr/delays.json"
  train_delay_summary        = "${var.project_name}-${var.environment}-train-delay-summary"
}

data "archive_file" "train_delay_collector" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/train_delay_collector"
  output_path = "${path.module}/.terraform/train-delay-collector.zip"
}

resource "aws_s3_bucket" "train_delay_archive" {
  bucket = local.train_delay_archive_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "train_delay_archive" {
  bucket = aws_s3_bucket.train_delay_archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "train_delay_archive" {
  bucket = aws_s3_bucket.train_delay_archive.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "train_delay_archive" {
  bucket = aws_s3_bucket.train_delay_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "train_delay_archive" {
  bucket = aws_s3_bucket.train_delay_archive.id

  rule {
    id     = "expire-old-train-delay-snapshots"
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
    id     = "expire-delay-collection-claims"
    status = "Enabled"

    filter {
      prefix = "claims/"
    }

    expiration {
      days = 2
    }
  }
}

resource "aws_dynamodb_table" "train_delay_summary" {
  name         = local.train_delay_summary
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

data "aws_iam_policy_document" "train_delay_collector_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "train_delay_collector" {
  name               = "${var.project_name}-${var.environment}-train-delay-collector"
  assume_role_policy = data.aws_iam_policy_document.train_delay_collector_assume_role.json
}

resource "aws_cloudwatch_log_group" "train_delay_collector" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-train-delay-collector"
  retention_in_days = 30
}

data "aws_iam_policy_document" "train_delay_collector" {
  statement {
    sid = "WriteDelaySnapshots"
    actions = [
      "s3:PutObject",
    ]
    resources = [
      "${aws_s3_bucket.train_delay_archive.arn}/claims/*",
      "${aws_s3_bucket.train_delay_archive.arn}/raw/*",
      "${aws_s3_bucket.website.arn}/${local.train_delay_latest_key}",
    ]
  }

  statement {
    sid       = "WriteDelaySummaries"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.train_delay_summary.arn]
  }

  statement {
    sid = "WriteLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.train_delay_collector.arn}:*"]
  }
}

resource "aws_iam_role_policy" "train_delay_collector" {
  name   = "collect-and-store-train-delay-snapshots"
  role   = aws_iam_role.train_delay_collector.id
  policy = data.aws_iam_policy_document.train_delay_collector.json
}

resource "aws_lambda_function" "train_delay_collector" {
  function_name = "${var.project_name}-${var.environment}-train-delay-collector"
  description   = "Fetch each unique JR West delay source at most once per minute"
  role          = aws_iam_role.train_delay_collector.arn
  runtime       = "python3.12"
  architectures = ["arm64"]
  handler       = "handler.lambda_handler"

  filename         = data.archive_file.train_delay_collector.output_path
  source_code_hash = data.archive_file.train_delay_collector.output_base64sha256

  memory_size = 256
  timeout     = 90

  environment {
    variables = {
      ARCHIVE_BUCKET = aws_s3_bucket.train_delay_archive.id
      LATEST_BUCKET  = aws_s3_bucket.website.id
      LATEST_KEY     = local.train_delay_latest_key
      SUMMARY_TABLE  = aws_dynamodb_table.train_delay_summary.name
      SUMMARY_RETENTION_DAYS = tostring(
        var.train_monitor_archive_retention_days
      )
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.train_delay_collector,
    aws_iam_role_policy.train_delay_collector,
  ]
}

data "aws_iam_policy_document" "train_delay_scheduler_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "train_delay_scheduler" {
  name               = "${var.project_name}-${var.environment}-train-delay-scheduler"
  assume_role_policy = data.aws_iam_policy_document.train_delay_scheduler_assume_role.json
}

data "aws_iam_policy_document" "train_delay_scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.train_delay_collector.arn]
  }
}

resource "aws_iam_role_policy" "train_delay_scheduler" {
  name   = "invoke-train-delay-collector"
  role   = aws_iam_role.train_delay_scheduler.id
  policy = data.aws_iam_policy_document.train_delay_scheduler.json
}

resource "aws_scheduler_schedule" "train_delay_collector" {
  name                         = "${var.project_name}-${var.environment}-train-delay-every-minute"
  description                  = "Collect unique JR West delay sources every minute"
  schedule_expression          = "rate(1 minute)"
  schedule_expression_timezone = "Asia/Tokyo"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.train_delay_collector.arn
    role_arn = aws_iam_role.train_delay_scheduler.arn
    input    = jsonencode({ source = "transitforge.delay-scheduler" })

    retry_policy {
      maximum_event_age_in_seconds = 60
      maximum_retry_attempts       = 0
    }
  }

  depends_on = [aws_iam_role_policy.train_delay_scheduler]
}
