# #479 Phase A: private persistence foundation; no API route or runtime cutover.
# Trip V2 retains its existing table and repository.
resource "aws_dynamodb_table" "server_state" {
  name                        = "${local.resource_prefix}-server-state"
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
  server_side_encryption {
    enabled = true
  }
  point_in_time_recovery {
    enabled = true
  }
}

# Owner scope is enforced by the repository, not request-supplied IAM/session keys.
# Transactions authorize their constituent actions; no Scan or index/wildcard ARN.
data "aws_iam_policy_document" "server_state_storage" {
  statement {
    sid       = "OwnerScopedServerState"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.server_state.arn]
  }
}

resource "aws_iam_role_policy" "server_state_storage" {
  name   = "owner-scoped-server-state-storage"
  role   = aws_iam_role.bedrock_agent.id
  policy = data.aws_iam_policy_document.server_state_storage.json
}

output "server_state_table_name" {
  description = "Private Conversation/Profile table; runtime composition is connected in #479 Phase B."
  value       = aws_dynamodb_table.server_state.name
}
