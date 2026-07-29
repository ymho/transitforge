variable "aws_region" {
  description = "Terraform state bucketを作成するAWSリージョン。"
  type        = string
  default     = "ap-northeast-1"
}

variable "state_bucket_name" {
  description = "Terraform stateを保存する、全世界で一意なS3バケット名。"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_nameは3〜63文字の有効なS3バケット名にしてください。"
  }
}
