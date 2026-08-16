resource "aws_secretsmanager_secret" "travel_provider" {
  name                    = "/${var.project_name}/${var.environment}/travel-provider"
  description             = "Credentials for the 旅行提供者 provider adapter"
  recovery_window_in_days = 7
}
