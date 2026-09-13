# Private Trip resource foundation. No public route, authorizer or writer rollout in #388.
resource "aws_dynamodb_table" "trips" {
  name                        = "${local.resource_prefix}-trips"
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

# Internal access only; owner scoping is mandatory in TripRepository. No Scan or wildcard ARN.
data "aws_iam_policy_document" "trip_storage" {
  statement {
    sid = "OwnerScopedTripStorage"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.trips.arn]
  }
}
resource "aws_iam_role_policy" "trip_storage" {
  name   = "owner-scoped-trip-storage"
  role   = aws_iam_role.bedrock_agent.id
  policy = data.aws_iam_policy_document.trip_storage.json
}
