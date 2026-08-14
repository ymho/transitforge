data "aws_caller_identity" "current" {}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  resource_prefix = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
  website_origin  = "${var.project_name}-${var.environment}-website"
  ai_agent_origin = "${var.project_name}-${var.environment}-ai-agent"
}

resource "aws_s3_bucket" "website" {
  bucket = "${local.resource_prefix}-web"
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "website" {
  bucket = aws_s3_bucket.website.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "website" {
  bucket = aws_s3_bucket.website.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  rule {
    id     = "expire-old-object-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "expire-train-monitor-cache-versions"
    status = "Enabled"

    filter {
      prefix = "api/westjr/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
}

resource "aws_cloudfront_origin_access_control" "website" {
  name                              = "${var.project_name}-${var.environment}-website"
  description                       = "CloudFront access to the private TransitForge website bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "ai_agent" {
  name                              = "${var.project_name}-${var.environment}-ai-agent"
  description                       = "CloudFront access to the private TransitForge AI Lambda URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "basic_auth" {
  name    = "${var.project_name}-${var.environment}-basic-auth"
  comment = "Require Basic authentication before serving TransitForge"
  runtime = "cloudfront-js-2.0"
  publish = true
  code = templatefile("${path.module}/cloudfront-basic-auth.js.tftpl", {
    auth_username      = var.basic_auth_username
    credentials_sha256 = var.basic_auth_credentials_sha256
  })
}

resource "aws_cloudfront_function" "legacy_redirect" {
  name    = "${var.project_name}-${var.environment}-legacy-redirect"
  comment = "Redirect the legacy CloudFront hostname to the canonical viewer hostname"
  runtime = "cloudfront-js-2.0"
  publish = true
  code = templatefile("${path.module}/cloudfront-redirect.js.tftpl", {
    target_hostname = var.viewer_domain_name
  })
}

resource "aws_cloudfront_distribution" "website" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.website.id
    origin_id                = local.website_origin
  }

  dynamic "origin" {
    for_each = var.legacy_cloudfront_redirect_enabled ? [] : [true]

    content {
      domain_name = trimsuffix(
        trimprefix(aws_lambda_function_url.ai_agent.function_url, "https://"),
        "/",
      )
      origin_access_control_id = aws_cloudfront_origin_access_control.ai_agent.id
      origin_id                = local.ai_agent_origin

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.legacy_cloudfront_redirect_enabled ? [] : [true]

    content {
      path_pattern             = "/api/agent"
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
      target_origin_id         = local.ai_agent_origin
      viewer_protocol_policy   = "https-only"
      compress                 = true

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.basic_auth.arn
      }
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.legacy_cloudfront_redirect_enabled ? [] : [true]

    content {
      path_pattern           = "/viewer-input/*"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD", "OPTIONS"]
      cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id
      target_origin_id       = local.website_origin
      viewer_protocol_policy = "https-only"
      compress               = true

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.basic_auth.arn
      }
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    target_origin_id       = local.website_origin
    viewer_protocol_policy = var.legacy_cloudfront_redirect_enabled ? "allow-all" : "redirect-to-https"
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = var.legacy_cloudfront_redirect_enabled ? aws_cloudfront_function.legacy_redirect.arn : aws_cloudfront_function.basic_auth.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    precondition {
      condition     = !var.legacy_cloudfront_redirect_enabled || var.cloudflare_front_door_enabled
      error_message = "legacy_cloudfront_redirect_enabledを有効にする前にcloudflare_front_door_enabledを有効にしてください。"
    }
  }
}

data "aws_iam_policy_document" "website" {
  statement {
    sid = "AllowCloudFrontRead"

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.website.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "AWS:SourceArn"
      values = compact([
        var.legacy_cloudfront_redirect_enabled ? null : aws_cloudfront_distribution.website.arn,
        var.cloudflare_front_door_enabled ? aws_cloudfront_distribution.viewer[0].arn : null,
      ])
    }
  }
}

resource "aws_s3_bucket_policy" "website" {
  bucket = aws_s3_bucket.website.id
  policy = data.aws_iam_policy_document.website.json
}
