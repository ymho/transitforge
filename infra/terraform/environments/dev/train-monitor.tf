locals {
  train_monitor_archive_bucket = "${local.resource_prefix}-train-monitor-archive"
  train_congestion_summary     = "${var.project_name}-${var.environment}-train-congestion-summary"
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
