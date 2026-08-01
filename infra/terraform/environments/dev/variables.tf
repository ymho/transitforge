variable "aws_region" {
  description = "アプリケーションのAWSリージョン。"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "リソース名とタグに使用するプロジェクト名。"
  type        = string
  default     = "transitforge"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_name))
    error_message = "project_nameは英小文字から始まる3〜31文字の英小文字・数字・ハイフンにしてください。"
  }
}

variable "environment" {
  description = "リソース名とタグに使用する環境名。"
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.environment))
    error_message = "environmentは英小文字から始まる2〜16文字の英小文字・数字・ハイフンにしてください。"
  }
}

variable "basic_auth_username" {
  description = "CloudFront Basic認証のユーザー名。パスワードハッシュ生成時にも同じ値を使用する。"
  type        = string
  default     = "trf"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,64}$", var.basic_auth_username))
    error_message = "basic_auth_usernameは1〜64文字の英数字・ピリオド・アンダースコア・ハイフンにしてください。"
  }
}

variable "basic_auth_credentials_sha256" {
  description = "「ユーザー名:パスワード」をSHA-256でハッシュした16進数64文字。平文のパスワードは保存しない。"
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.basic_auth_credentials_sha256))
    error_message = "basic_auth_credentials_sha256は小文字のSHA-256ハッシュ（16進数64文字）にしてください。"
  }
}

variable "bedrock_model_id" {
  description = "AI駅員がConverse APIで使用するAmazon BedrockモデルID。"
  type        = string
  default     = "amazon.nova-lite-v1:0"

  validation {
    condition     = can(regex("^amazon\\.nova-[a-z0-9.-]+:[0-9]+$", var.bedrock_model_id))
    error_message = "bedrock_model_idにはAmazon Novaの基盤モデルIDを指定してください。"
  }
}

variable "github_repository" {
  description = "GitHub Actions OIDCでAWSへのデプロイを許可するowner/repository。"
  type        = string
  default     = "ymho/transitforge"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repositoryはowner/repository形式にしてください。"
  }
}

variable "data_builder_github_oidc_subject" {
  description = "data-builderインフラのデプロイを許可するGitHub Actions OIDCのimmutable subject。"
  type        = string
  default     = "repo:ymho@26107646/transitforge-data-builder@1319024314:environment:dev"

  validation {
    condition = can(regex(
      "^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+:environment:[A-Za-z0-9_.-]+$",
      var.data_builder_github_oidc_subject,
    ))
    error_message = "data_builder_github_oidc_subjectはowner IDとrepository IDを含むimmutable subject形式にしてください。"
  }
}

variable "train_monitor_archive_retention_days" {
  description = "毎分収集する運行情報アーカイブの保持日数。"
  type        = number
  default     = 730

  validation {
    condition = (
      var.train_monitor_archive_retention_days >= 30
      && var.train_monitor_archive_retention_days <= 3650
    )
    error_message = "train_monitor_archive_retention_daysは30〜3650日にしてください。"
  }
}
