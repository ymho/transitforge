# #480 Phase B: preparation only. No public ingress and no current caller wiring.
variable "enable_fixed_egress_provider" {
  type        = bool
  default     = false
  description = "Create the private accommodation Provider boundary; does not switch production traffic."
}
variable "fixed_egress_agent_role_name" {
  type        = string
  default     = null
  nullable    = true
  description = "Dedicated non-VPC Server Agent role to grant Invoke only at #480 integration."
}
locals {
  fixed_egress_provider_name    = "${local.resource_prefix}-fixed-egress-provider"
  fixed_egress_provider_package = jsondecode(file("${path.module}/../../../packaging/fixed-egress-provider.json"))
}
data "archive_file" "fixed_egress_provider" {
  count       = var.enable_fixed_egress_provider ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.fixed_egress_provider_package.source}"
  output_path = "${path.module}/.terraform/fixed-egress-provider.zip"
}
resource "aws_secretsmanager_secret" "fixed_egress_travel_provider" {
  count                   = var.enable_fixed_egress_provider ? 1 : 0
  name                    = "/${var.project_name}/${var.environment}/fixed-egress-travel-provider"
  description             = "Accommodation credentials only; populated outside Terraform at integration"
  recovery_window_in_days = 7
}
resource "aws_cloudwatch_log_group" "fixed_egress_provider" {
  count             = var.enable_fixed_egress_provider ? 1 : 0
  name              = "/aws/lambda/${local.fixed_egress_provider_name}"
  retention_in_days = 30
}
resource "aws_iam_role" "fixed_egress_provider" {
  count              = var.enable_fixed_egress_provider ? 1 : 0
  name               = local.fixed_egress_provider_name
  assume_role_policy = data.aws_iam_policy_document.bedrock_agent_assume_role.json
}
data "aws_iam_policy_document" "fixed_egress_provider" {
  count = var.enable_fixed_egress_provider ? 1 : 0
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.fixed_egress_travel_provider[0].arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fixed_egress_provider[0].arn}:*"]
  }
  # Lambda ENI lifecycle requires unscoped EC2 actions, like the existing VPC Lambda.
  statement {
    actions = [
      "ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets",
      "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }
}
resource "aws_iam_role_policy" "fixed_egress_provider" {
  count  = var.enable_fixed_egress_provider ? 1 : 0
  role   = aws_iam_role.fixed_egress_provider[0].id
  policy = data.aws_iam_policy_document.fixed_egress_provider[0].json
}
resource "aws_lambda_function" "fixed_egress_provider" {
  count            = var.enable_fixed_egress_provider ? 1 : 0
  function_name    = local.fixed_egress_provider_name
  role             = aws_iam_role.fixed_egress_provider[0].arn
  runtime          = local.fixed_egress_provider_package.runtime
  handler          = local.fixed_egress_provider_package.handler
  filename         = data.archive_file.fixed_egress_provider[0].output_path
  source_code_hash = data.archive_file.fixed_egress_provider[0].output_base64sha256
  timeout          = 25
  memory_size      = 256
  vpc_config {
    subnet_ids         = [aws_subnet.ai_egress_private.id]
    security_group_ids = [aws_security_group.ai_lambda.id]
  }
  environment {
    variables = { FIXED_EGRESS_TRAVEL_SECRET_ARN = aws_secretsmanager_secret.fixed_egress_travel_provider[0].arn }
  }
  depends_on = [aws_iam_role_policy.fixed_egress_provider]
}
data "aws_iam_policy_document" "invoke_fixed_egress_provider" {
  count = var.enable_fixed_egress_provider ? 1 : 0
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.fixed_egress_provider[0].arn]
  }
}
resource "aws_iam_role_policy" "invoke_fixed_egress_provider" {
  count  = var.enable_fixed_egress_provider && var.fixed_egress_agent_role_name != null ? 1 : 0
  name   = "invoke-fixed-egress-accommodation"
  role   = var.fixed_egress_agent_role_name
  policy = data.aws_iam_policy_document.invoke_fixed_egress_provider[0].json
}
output "fixed_egress_provider_function_arn" {
  value = var.enable_fixed_egress_provider ? aws_lambda_function.fixed_egress_provider[0].arn : null
}
