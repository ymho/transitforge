variable "enforce_japan_country" {
  type        = bool
  default     = true
  description = "Enforce Japan-only access. Disable only for the protected initial origin-key preparation."
}

locals {
  japan_viewer_function_arn = var.cloudflare_front_door_enabled ? (var.enforce_japan_country ? aws_cloudfront_function.japan_only[0].arn : aws_cloudfront_function.japan_access_probe[0].arn) : null
}

resource "aws_cloudfront_function" "japan_only" {
  count   = var.cloudflare_front_door_enabled ? 1 : 0
  name    = "${local.resource_prefix}-japan-only"
  runtime = "cloudfront-js-2.0"
  comment = "Allow Japanese visitors using the country header from the authenticated Cloudflare proxy"
  publish = true
  code    = file("${path.module}/cloudfront-japan-only.js")
}

resource "aws_cloudfront_function" "japan_access_probe" {
  count   = var.cloudflare_front_door_enabled && !var.enforce_japan_country ? 1 : 0
  name    = "${local.resource_prefix}-japan-access-probe"
  runtime = "cloudfront-js-2.0"
  comment = "Temporary country-header probe during protected initial preparation; preserves existing access"
  publish = true
  code    = file("${path.module}/cloudfront-japan-access-probe.js")
}
