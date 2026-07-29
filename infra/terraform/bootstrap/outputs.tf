output "state_bucket_name" {
  description = "環境別Terraform stateで使用するS3バケット名。"
  value       = aws_s3_bucket.terraform_state.id
}
