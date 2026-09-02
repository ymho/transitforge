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

variable "viewer_domain_name" {
  description = "Cloudflare経由で公開するTransitForgeのFQDN。"
  type        = string
  default     = "app.ohmyki.com"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.viewer_domain_name))
    error_message = "viewer_domain_nameには小文字のFQDNを指定してください。"
  }
}

variable "cloudflare_front_door_enabled" {
  description = "Cloudflare AOPからだけ接続できる独自ドメイン用CloudFrontを作成するか。"
  type        = bool
  default     = false
}

variable "legacy_cloudfront_redirect_enabled" {
  description = "既存CloudFrontドメインを独自ドメインへのリダイレクト専用に切り替えるか。"
  type        = bool
  default     = false
}

variable "mtls_ca_bundle_key" {
  description = "CloudFront viewer mTLSが信頼するCA証明書bundleのS3キー。"
  type        = string
  default     = "cloudflare-aop/ca.pem"

  validation {
    condition     = !startswith(var.mtls_ca_bundle_key, "/") && endswith(var.mtls_ca_bundle_key, ".pem")
    error_message = "mtls_ca_bundle_keyには先頭スラッシュなしのPEMファイルキーを指定してください。"
  }
}

variable "bedrock_model_id" {
  description = "Raiquoraが既定でConverse APIに使用するAmazon Bedrock基盤モデルID。"
  type        = string
  default     = "amazon.nova-lite-v1:0"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$", var.bedrock_model_id))
    error_message = "bedrock_model_idには安全なAmazon Bedrock基盤モデルIDを指定してください。"
  }
}

variable "bedrock_lightweight_model_id" {
  description = "比較評価用の軽量model ID。空文字では既定modelへフォールバックする。"
  type        = string
  default     = ""

  validation {
    condition = var.bedrock_lightweight_model_id == "" || can(regex(
      "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$",
      var.bedrock_lightweight_model_id,
    ))
    error_message = "bedrock_lightweight_model_idには安全な基盤モデルIDまたは空文字を指定してください。"
  }
}

variable "bedrock_decision_model_id" {
  description = "既存旅程判断と結果駆動再計画に使う意思決定modelまたはinference profile ID。空文字では既定modelへフォールバックする。"
  type        = string
  default     = "jp.amazon.nova-2-lite-v1:0"

  validation {
    condition = var.bedrock_decision_model_id == "" || can(regex(
      "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$",
      var.bedrock_decision_model_id,
    ))
    error_message = "bedrock_decision_model_idには安全な基盤モデルIDまたは空文字を指定してください。"
  }
}

variable "ai_nat_instance_type" {
  description = "AI Lambdaの固定送信元IPに使うNATインスタンスの種別。"
  type        = string
  # bootstrap時の一時的なメモリ不足は永続swapで補い 定常時の小さなNAT負荷へ合わせる
  default = "t4g.nano"

  validation {
    condition     = can(regex("^t4g\\.(nano|micro|small)$", var.ai_nat_instance_type))
    error_message = "ai_nat_instance_typeにはt4g.nano t4g.micro t4g.smallのいずれかを指定してください。"
  }
}

variable "github_repository" {
  description = "GitHub Actions OIDCでAWSへのデプロイを許可するowner/repository。"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repositoryはowner/repository形式にしてください。"
  }
}

variable "data_builder_github_oidc_subject" {
  description = "data-builderインフラのデプロイを許可するGitHub Actions OIDCのimmutable subject。"
  type        = string

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
