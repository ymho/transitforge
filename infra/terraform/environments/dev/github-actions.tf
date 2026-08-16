locals {
  github_oidc_url                    = "https://token.actions.githubusercontent.com"
  github_environment                 = var.environment
  github_repository_sub              = "repo:${var.github_repository}:environment:${local.github_environment}"
  github_deploy_role                 = "${var.project_name}-${var.environment}-github-deploy"
  data_builder_github_repository_sub = var.data_builder_github_oidc_subject
  data_builder_github_deploy_role    = "${var.project_name}-${var.environment}-data-builder-github-deploy"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = local.github_oidc_url
  client_id_list = ["sts.amazonaws.com"]

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_repository_sub]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = local.github_deploy_role
  description          = "Deploy TransitForge dev from the protected GitHub environment"
  assume_role_policy   = data.aws_iam_policy_document.github_actions_assume_role.json
  max_session_duration = 3600

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_iam_role_policy_attachment" "github_deploy_power_user" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

data "aws_iam_policy_document" "github_deploy_iam" {
  statement {
    sid = "ManageTransitForgeRoles"
    actions = [
      "iam:AttachRolePolicy",
      "iam:AddRoleToInstanceProfile",
      "iam:CreateRole",
      "iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetInstanceProfile",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:PassRole",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRoleDescription",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-*",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/${var.project_name}-*",
    ]
  }

  statement {
    sid = "ManageGitHubOidcProvider"
    actions = [
      "iam:AddClientIDToOpenIDConnectProvider",
      "iam:CreateOpenIDConnectProvider",
      "iam:DeleteOpenIDConnectProvider",
      "iam:GetOpenIDConnectProvider",
      "iam:ListOpenIDConnectProviderTags",
      "iam:RemoveClientIDFromOpenIDConnectProvider",
      "iam:TagOpenIDConnectProvider",
      "iam:UntagOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint",
    ]
    resources = [
      aws_iam_openid_connect_provider.github_actions.arn,
    ]
  }
}

resource "aws_iam_role_policy" "github_deploy_iam" {
  name   = "manage-transitforge-iam"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy_iam.json
}

data "aws_iam_policy_document" "data_builder_github_actions_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.data_builder_github_repository_sub]
    }
  }
}

resource "aws_iam_role" "data_builder_github_deploy" {
  name                 = local.data_builder_github_deploy_role
  description          = "Deploy data-builder infrastructure and image from its protected GitHub environment"
  assume_role_policy   = data.aws_iam_policy_document.data_builder_github_actions_assume_role.json
  max_session_duration = 3600

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_iam_role_policy_attachment" "data_builder_github_deploy_power_user" {
  role       = aws_iam_role.data_builder_github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

data "aws_iam_policy_document" "data_builder_github_deploy_iam" {
  statement {
    sid = "ManageDataBuilderRoles"
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:PassRole",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRoleDescription",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-${var.environment}-data-builder-execution",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-${var.environment}-data-builder-task",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-${var.environment}-data-builder-scheduler",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-${var.environment}-data-builder-traffic-collector",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-${var.environment}-data-builder-traffic-scheduler",
    ]
  }
}

resource "aws_iam_role_policy" "data_builder_github_deploy_iam" {
  name   = "manage-data-builder-iam"
  role   = aws_iam_role.data_builder_github_deploy.id
  policy = data.aws_iam_policy_document.data_builder_github_deploy_iam.json
}
