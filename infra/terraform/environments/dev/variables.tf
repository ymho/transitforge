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
  default     = "jp.amazon.nova-2-lite-v1:0"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$", var.bedrock_model_id))
    error_message = "bedrock_model_idには安全なAmazon Bedrock基盤モデルIDを指定してください。"
  }
}

variable "bedrock_capability_matrix_json" {
  description = "完全一致model IDごとのreview済みBedrock capability JSON。未登録modelは未実測として扱う。"
  type        = string
  default     = "{}"
  validation {
    condition     = can(jsondecode(var.bedrock_capability_matrix_json)) && length(var.bedrock_capability_matrix_json) <= 3000
    error_message = "bedrock_capability_matrix_jsonには3,000文字以下のJSONを指定してください。"
  }
}

variable "bedrock_prompt_caching_enabled" {
  description = "capability matrixが対応を示すmodelでPrompt Cachingを有効にする。"
  type        = bool
  default     = false
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

variable "conversation_semantic_kernel_enabled" {
  description = "会話発言を回答生成前に型付き意味差分として受理する段階導入gate。"
  type        = bool
  default     = false
}

variable "agent_runtime_v2_enabled" {
  description = "Strands Agent v2実行層を明示評価用に有効化する。既定falseでV1を維持する。"
  type        = bool
  default     = false
}

variable "travel_knowledge_base_id" {
  description = "既存のBedrock Knowledge Base ID。空文字ではKnowledge retrievalを無効にしWeb-onlyへ戻す。"
  type        = string
  default     = ""
  validation {
    condition     = var.travel_knowledge_base_id == "" || can(regex("^[0-9A-Za-z]{10}$", var.travel_knowledge_base_id))
    error_message = "travel_knowledge_base_idは10文字のKnowledge Base IDまたは空文字にしてください。"
  }
}

variable "travel_knowledge_vector_store" {
  description = "HYBRID capability判定に使うVector Store構成。"
  type        = string
  default     = "other"
  validation {
    condition     = contains(["opensearch_serverless_filterable_text", "rds_filterable_text", "mongodb_filterable_text", "s3_vectors", "other"], var.travel_knowledge_vector_store)
    error_message = "travel_knowledge_vector_storeは定義済みcapabilityのいずれかにしてください。"
  }
}

variable "travel_knowledge_search_type" {
  description = "Knowledge retrievalで要求する検索モード。非対応構成ではApplicationがSEMANTICへ明示的に降格する。"
  type        = string
  default     = "SEMANTIC"
  validation {
    condition     = contains(["HYBRID", "SEMANTIC"], var.travel_knowledge_search_type)
    error_message = "travel_knowledge_search_typeはHYBRIDまたはSEMANTICにしてください。"
  }
}

variable "bedrock_rerank_model_arn" {
  description = "独立Rerankに使う既存Bedrock reranker model ARN。空文字では元順位を維持する。"
  type        = string
  default     = ""
  validation {
    condition     = var.bedrock_rerank_model_arn == "" || can(regex("^arn:aws:bedrock:[a-z0-9-]+::foundation-model/[A-Za-z0-9._:/-]+$", var.bedrock_rerank_model_arn))
    error_message = "bedrock_rerank_model_arnはBedrock foundation model ARNまたは空文字にしてください。"
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
