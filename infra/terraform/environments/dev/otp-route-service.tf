variable "otp_region_id" {
  type        = string
  default     = "izumo-matsue"
  description = "Explicit region of the validated graph. One region is served per deployment."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,63}$", var.otp_region_id))
    error_message = "otp_region_id must be a lowercase slug."
  }
}

variable "enable_otp_route_service" {
  type        = bool
  default     = false
  description = "Create the private pinned OTP service and IAM-only bridge."
}

variable "otp_graph_version" {
  type        = string
  default     = ""
  description = "Validated Data Builder graph version, never the mutable current pointer."
  validation {
    condition     = var.otp_graph_version == "" || can(regex("^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$", var.otp_graph_version))
    error_message = "otp_graph_version must be a version emitted by Data Builder."
  }
}

variable "otp_image" {
  type        = string
  default     = ""
  description = "Official OTP image digest recorded in the selected graph manifest."
  validation {
    condition     = var.otp_image == "" || can(regex("^docker\\.io/opentripplanner/opentripplanner@sha256:[0-9a-f]{64}$", var.otp_image))
    error_message = "otp_image must be an official digest-pinned OTP image."
  }
}

variable "otp_graph_sha256" {
  type        = string
  default     = ""
  description = "Full graph.obj SHA-256 copied from the selected graph manifest."
  validation {
    condition     = var.otp_graph_sha256 == "" || can(regex("^[0-9a-f]{64}$", var.otp_graph_sha256))
    error_message = "otp_graph_sha256 must be the lowercase SHA-256 recorded in the graph manifest."
  }
}

variable "otp_graph_loader_image" {
  type        = string
  default     = ""
  description = "AWS CLI public ECR image pinned by digest for the graph init container."
  validation {
    condition     = var.otp_graph_loader_image == "" || can(regex("^public\\.ecr\\.aws/aws-cli/aws-cli@sha256:[0-9a-f]{64}$", var.otp_graph_loader_image))
    error_message = "otp_graph_loader_image must be an AWS CLI public ECR image pinned by digest."
  }
}

locals {
  otp_service_name       = "${local.resource_prefix}-otp"
  otp_graph_bucket       = "${local.resource_prefix}-data-builder-source"
  otp_graph_key          = "otp/${var.otp_region_id}/versions/${var.otp_graph_version}/graph.obj"
  otp_graph_manifest_key = "otp/${var.otp_region_id}/versions/${var.otp_graph_version}/manifest.json"
  otp_bridge_package     = jsondecode(file("${path.module}/../../../packaging/otp-route-bridge.json"))
  otp_private_domain     = "otp.${local.resource_prefix}.internal"
}

check "otp_route_service_inputs" {
  assert {
    condition = !var.enable_otp_route_service || (
      var.otp_graph_version != "" && var.otp_graph_sha256 != "" && var.otp_image != "" && var.otp_graph_loader_image != ""
    )
    error_message = "Enable OTP only with a pinned graph version, graph hash, matching OTP image and pinned loader image."
  }
}

resource "aws_ecs_cluster" "otp" {
  count = var.enable_otp_route_service ? 1 : 0
  name  = local.otp_service_name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "otp" {
  count             = var.enable_otp_route_service ? 1 : 0
  name              = "/ecs/${local.otp_service_name}"
  retention_in_days = 30
}

data "aws_iam_policy_document" "otp_task_assume" {
  count = var.enable_otp_route_service ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "otp_execution" {
  count              = var.enable_otp_route_service ? 1 : 0
  name               = "${local.otp_service_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.otp_task_assume[0].json
}
resource "aws_iam_role_policy_attachment" "otp_execution" {
  count      = var.enable_otp_route_service ? 1 : 0
  role       = aws_iam_role.otp_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role" "otp_task" {
  count              = var.enable_otp_route_service ? 1 : 0
  name               = "${local.otp_service_name}-task"
  assume_role_policy = data.aws_iam_policy_document.otp_task_assume[0].json
}
resource "aws_iam_role_policy" "otp_task" {
  count = var.enable_otp_route_service ? 1 : 0
  name  = "read-pinned-otp-graph"
  role  = aws_iam_role.otp_task[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::${local.otp_graph_bucket}/${local.otp_graph_key}"
  }] })
}

resource "aws_security_group" "otp_service" {
  count       = var.enable_otp_route_service ? 1 : 0
  name        = "${local.otp_service_name}-service"
  description = "Private OTP service; only the route bridge may call it"
  vpc_id      = aws_vpc.ai_egress.id
  ingress {
    description     = "OTP HTTP from route bridge"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.otp_bridge[0].id]
  }
  egress {
    description = "HTTPS for S3 graph download and container image pulls"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "DNS to the VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["${cidrhost(aws_vpc.ai_egress.cidr_block, 2)}/32"]
  }
  egress {
    description = "DNS fallback to the VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["${cidrhost(aws_vpc.ai_egress.cidr_block, 2)}/32"]
  }
}

resource "aws_security_group" "otp_bridge" {
  count       = var.enable_otp_route_service ? 1 : 0
  name        = "${local.otp_service_name}-bridge"
  description = "OTP bridge egress only"
  vpc_id      = aws_vpc.ai_egress.id
  egress {
    description = "OTP query"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = [aws_subnet.ai_egress_private.cidr_block]
  }
  egress {
    description = "S3 manifest read through existing NAT"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "DNS to the VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["${cidrhost(aws_vpc.ai_egress.cidr_block, 2)}/32"]
  }
  egress {
    description = "DNS fallback to the VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["${cidrhost(aws_vpc.ai_egress.cidr_block, 2)}/32"]
  }
}

resource "aws_service_discovery_private_dns_namespace" "otp" {
  count = var.enable_otp_route_service ? 1 : 0
  name  = "${local.resource_prefix}.internal"
  vpc   = aws_vpc.ai_egress.id
}
resource "aws_service_discovery_service" "otp" {
  count = var.enable_otp_route_service ? 1 : 0
  name  = "otp"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.otp[0].id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_task_definition" "otp" {
  count                    = var.enable_otp_route_service ? 1 : 0
  family                   = local.otp_service_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "2048"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.otp_execution[0].arn
  task_role_arn            = aws_iam_role.otp_task[0].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  ephemeral_storage { size_in_gib = 30 }
  volume { name = "otp-graph" }
  container_definitions = jsonencode([
    {
      name        = "load-graph", image = var.otp_graph_loader_image, essential = false, entryPoint = ["sh", "-c"],
      command     = ["aws s3 cp 's3://${local.otp_graph_bucket}/${local.otp_graph_key}' /otp/graph.obj --only-show-errors && printf '%s  %s\\n' '${var.otp_graph_sha256}' /otp/graph.obj | sha256sum -c -"],
      mountPoints = [{ sourceVolume = "otp-graph", containerPath = "/otp", readOnly = false }],
      logConfiguration = { logDriver = "awslogs", options = {
        awslogs-group = aws_cloudwatch_log_group.otp[0].name, awslogs-region = var.aws_region, awslogs-stream-prefix = "load"
      } }
    },
    {
      name         = "otp", image = var.otp_image, essential = true, command = ["--load", "--serve"],
      dependsOn    = [{ containerName = "load-graph", condition = "SUCCESS" }],
      environment  = [{ name = "JAVA_TOOL_OPTIONS", value = "-Xms1g -Xmx3g" }],
      mountPoints  = [{ sourceVolume = "otp-graph", containerPath = "/var/opentripplanner", readOnly = true }],
      portMappings = [{ containerPort = 8080, protocol = "tcp" }],
      logConfiguration = { logDriver = "awslogs", options = {
        awslogs-group = aws_cloudwatch_log_group.otp[0].name, awslogs-region = var.aws_region, awslogs-stream-prefix = "serve"
      } }
    }
  ])
}

resource "aws_ecs_service" "otp" {
  count                              = var.enable_otp_route_service ? 1 : 0
  name                               = local.otp_service_name
  cluster                            = aws_ecs_cluster.otp[0].id
  task_definition                    = aws_ecs_task_definition.otp[0].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  wait_for_steady_state              = true
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    assign_public_ip = false
    subnets          = [aws_subnet.ai_egress_private.id]
    security_groups  = [aws_security_group.otp_service[0].id]
  }
  service_registries { registry_arn = aws_service_discovery_service.otp[0].arn }
  depends_on = [aws_iam_role_policy.otp_task, aws_iam_role_policy_attachment.otp_execution]
}

data "archive_file" "otp_bridge" {
  count       = var.enable_otp_route_service ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../../../../${local.otp_bridge_package.source}"
  output_path = "${path.module}/.terraform/otp-route-bridge.zip"
}
resource "aws_cloudwatch_log_group" "otp_bridge" {
  count             = var.enable_otp_route_service ? 1 : 0
  name              = "/aws/lambda/${local.otp_service_name}-bridge"
  retention_in_days = 30
}
resource "aws_iam_role" "otp_bridge" {
  count = var.enable_otp_route_service ? 1 : 0
  name  = "${local.otp_service_name}-bridge"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy" "otp_bridge" {
  count = var.enable_otp_route_service ? 1 : 0
  name  = "read-manifest-and-run-in-vpc"
  role  = aws_iam_role.otp_bridge[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.otp_bridge[0].arn}:*" },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::${local.otp_graph_bucket}/${local.otp_graph_manifest_key}" },
    { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
  ] })
}
resource "aws_lambda_function" "otp_bridge" {
  count            = var.enable_otp_route_service ? 1 : 0
  function_name    = "${local.otp_service_name}-bridge"
  role             = aws_iam_role.otp_bridge[0].arn
  filename         = data.archive_file.otp_bridge[0].output_path
  source_code_hash = data.archive_file.otp_bridge[0].output_base64sha256
  runtime          = local.otp_bridge_package.runtime
  handler          = local.otp_bridge_package.handler
  architectures    = ["arm64"]
  memory_size      = 256
  timeout          = 15
  vpc_config {
    subnet_ids         = [aws_subnet.ai_egress_private.id]
    security_group_ids = [aws_security_group.otp_bridge[0].id]
  }
  environment { variables = {
    OTP_GRAPHQL_ENDPOINT   = "http://${local.otp_private_domain}:8080/otp/gtfs/v1"
    OTP_GRAPH_BUCKET       = local.otp_graph_bucket
    OTP_GRAPH_MANIFEST_KEY = local.otp_graph_manifest_key
    OTP_GRAPH_VERSION      = var.otp_graph_version
    OTP_REGION_ID          = var.otp_region_id
    OTP_EXPECTED_IMAGE     = var.otp_image
    OTP_EXPECTED_GRAPH_SHA = var.otp_graph_sha256
  } }
  depends_on = [aws_iam_role_policy.otp_bridge, aws_ecs_service.otp]
}

output "otp_route_service" {
  description = "Pinned private OTP deployment; null while disabled."
  value = var.enable_otp_route_service ? {
    graph_version = var.otp_graph_version
    graph_sha256  = var.otp_graph_sha256
    bridge_arn    = aws_lambda_function.otp_bridge[0].arn
  } : null
}
