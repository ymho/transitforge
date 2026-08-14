resource "aws_acm_certificate" "viewer" {
  provider          = aws.us_east_1
  domain_name       = var.viewer_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_s3_bucket" "mtls_trust_store" {
  bucket = "${local.resource_prefix}-mtls-trust-store"
}

resource "aws_s3_bucket_public_access_block" "mtls_trust_store" {
  bucket = aws_s3_bucket.mtls_trust_store.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "mtls_trust_store" {
  bucket = aws_s3_bucket.mtls_trust_store.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "mtls_trust_store" {
  bucket = aws_s3_bucket.mtls_trust_store.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "mtls_trust_store" {
  bucket = aws_s3_bucket.mtls_trust_store.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_trust_store" "cloudflare_aop" {
  count = var.cloudflare_front_door_enabled ? 1 : 0

  name = "${var.project_name}-${var.environment}-cloudflare-aop"

  ca_certificates_bundle_source {
    ca_certificates_bundle_s3_location {
      bucket = aws_s3_bucket.mtls_trust_store.id
      key    = var.mtls_ca_bundle_key
      region = var.aws_region
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "cloudflare_no_store" {
  count = var.cloudflare_front_door_enabled ? 1 : 0

  name    = "${var.project_name}-${var.environment}-cloudflare-no-store"
  comment = "Prevent Cloudflare from caching responses protected by CloudFront Basic authentication"

  custom_headers_config {
    items {
      header   = "Cloudflare-CDN-Cache-Control"
      override = true
      value    = "no-store"
    }
  }
}

resource "aws_cloudfront_distribution" "viewer" {
  count = var.cloudflare_front_door_enabled ? 1 : 0

  aliases             = [var.viewer_domain_name]
  enabled             = true
  default_root_object = "index.html"
  http_version        = "http2"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.website.id
    origin_id                = local.website_origin
  }

  origin {
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

  ordered_cache_behavior {
    path_pattern               = "/api/agent"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cloudflare_no_store[0].id
    target_origin_id           = local.ai_agent_origin
    viewer_protocol_policy     = "https-only"
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/viewer-input/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cloudflare_no_store[0].id
    target_origin_id           = local.website_origin
    viewer_protocol_policy     = "https-only"
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cloudflare_no_store[0].id
    target_origin_id           = local.website_origin
    viewer_protocol_policy     = "https-only"
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.viewer.arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  viewer_mtls_config {
    mode = "required"

    trust_store_config {
      advertise_trust_store_ca_names = false
      ignore_certificate_expiry      = false
      trust_store_id                 = aws_cloudfront_trust_store.cloudflare_aop[0].id
    }
  }
}
