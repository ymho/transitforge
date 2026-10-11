resource "aws_cloudfront_function" "japan_only" {
  count   = var.cloudflare_front_door_enabled ? 1 : 0
  name    = "${local.resource_prefix}-japan-only"
  runtime = "cloudfront-js-2.0"
  comment = "Allow Japanese visitors using the country header from the authenticated Cloudflare proxy"
  publish = true
  code    = file("${path.module}/cloudfront-japan-only.js")
}
