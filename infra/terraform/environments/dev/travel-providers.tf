resource "aws_secretsmanager_secret" "rakuten_travel" {
  name                    = "/${var.project_name}/${var.environment}/rakuten-travel"
  description             = "Credentials for the Rakuten Travel provider adapter"
  recovery_window_in_days = 7
}
