provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "transitforge"
      ManagedBy = "terraform"
      Purpose   = "terraform-state"
    }
  }
}
