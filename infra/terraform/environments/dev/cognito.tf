# One source for browser configuration and the #484 verifier configuration.
locals {
  auth_origin  = "https://${var.viewer_domain_name}"
  auth_origins = concat([local.auth_origin], var.cognito_local_development_enabled ? ["http://localhost:5173"] : [])
}

variable "cognito_local_development_enabled" {
  description = "Allow the local SPA callback/logout in this development pool."
  type        = bool
  default     = false
}

resource "aws_cognito_user_pool" "users" {
  name                     = "${local.resource_prefix}-users"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"

  username_configuration {
    case_sensitive = false
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 1
  }
}

resource "aws_cognito_resource_server" "api" {
  identifier   = "raiquora"
  name         = "Raiquora user API"
  user_pool_id = aws_cognito_user_pool.users.id
  scope {
    scope_name        = "user"
    scope_description = "Authenticated Raiquora user operations; ownership is checked by the application"
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  name                                 = "${local.resource_prefix}-spa"
  user_pool_id                         = aws_cognito_user_pool.users.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = concat(["openid", "email"], aws_cognito_resource_server.api.scope_identifiers)
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [for origin in local.auth_origins : "${origin}/index.html"]
  logout_urls                          = [for origin in local.auth_origins : "${origin}/"]
  default_redirect_uri                 = "${local.auth_origin}/index.html"
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 5
  id_token_validity                    = 5
  refresh_token_validity               = 1
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }
}

resource "aws_cognito_user_pool_domain" "login" {
  domain                = "${local.resource_prefix}-login"
  user_pool_id          = aws_cognito_user_pool.users.id
  managed_login_version = 2
}

resource "aws_cognito_managed_login_branding" "spa" {
  user_pool_id                = aws_cognito_user_pool.users.id
  client_id                   = aws_cognito_user_pool_client.spa.id
  use_cognito_provided_values = true
  depends_on                  = [aws_cognito_user_pool_domain.login]
}

output "cognito_frontend_config" {
  description = "Public configuration; publish verbatim as auth-config.json, never add secrets."
  value = {
    issuer       = "https://${aws_cognito_user_pool.users.endpoint}"
    clientId     = aws_cognito_user_pool_client.spa.id
    loginOrigin  = "https://${aws_cognito_user_pool_domain.login.domain}.auth.${var.aws_region}.amazoncognito.com"
    scopes       = aws_cognito_user_pool_client.spa.allowed_oauth_scopes
    callbackUrls = aws_cognito_user_pool_client.spa.callback_urls
    logoutUrls   = aws_cognito_user_pool_client.spa.logout_urls
  }
}

output "cognito_api_auth_config" {
  description = "Pass userPoolId/clientId to #484 verifier and requiredScopes to authenticatedApplication."
  value = {
    userPoolId     = aws_cognito_user_pool.users.id
    clientId       = aws_cognito_user_pool_client.spa.id
    requiredScopes = aws_cognito_resource_server.api.scope_identifiers
  }
}
