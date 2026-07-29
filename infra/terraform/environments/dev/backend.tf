terraform {
  backend "s3" {
    key          = "transitforge/dev/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
