data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ssm_parameter" "ai_nat_instance_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  ai_egress_availability_zone = data.aws_availability_zones.available.names[0]
}

resource "aws_vpc" "ai_egress" {
  cidr_block           = "10.84.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_internet_gateway" "ai_egress" {
  vpc_id = aws_vpc.ai_egress.id
}

resource "aws_subnet" "ai_egress_public" {
  vpc_id                  = aws_vpc.ai_egress.id
  cidr_block              = "10.84.0.0/24"
  availability_zone       = local.ai_egress_availability_zone
  map_public_ip_on_launch = false
}

resource "aws_subnet" "ai_egress_private" {
  vpc_id            = aws_vpc.ai_egress.id
  cidr_block        = "10.84.1.0/24"
  availability_zone = local.ai_egress_availability_zone
}

resource "aws_route_table" "ai_egress_public" {
  vpc_id = aws_vpc.ai_egress.id
}

resource "aws_route" "ai_egress_public_internet" {
  route_table_id         = aws_route_table.ai_egress_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.ai_egress.id
}

resource "aws_route_table_association" "ai_egress_public" {
  subnet_id      = aws_subnet.ai_egress_public.id
  route_table_id = aws_route_table.ai_egress_public.id
}

resource "aws_route_table" "ai_egress_private" {
  vpc_id = aws_vpc.ai_egress.id
}

resource "aws_route" "ai_egress_private_internet" {
  route_table_id         = aws_route_table.ai_egress_private.id
  destination_cidr_block = "0.0.0.0/0"
  network_interface_id   = aws_instance.ai_nat.primary_network_interface_id
}

resource "aws_route_table_association" "ai_egress_private" {
  subnet_id      = aws_subnet.ai_egress_private.id
  route_table_id = aws_route_table.ai_egress_private.id
}

resource "aws_security_group" "ai_lambda" {
  name        = "${local.resource_prefix}-ai-lambda"
  description = "Outbound HTTPS from the TransitForge AI Lambda"
  vpc_id      = aws_vpc.ai_egress.id

  egress {
    description = "HTTPS through the NAT instance"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ai_nat" {
  name        = "${local.resource_prefix}-ai-nat"
  description = "Private HTTPS forwarding for the TransitForge AI Lambda"
  vpc_id      = aws_vpc.ai_egress.id

  ingress {
    description     = "HTTPS from the AI Lambda"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.ai_lambda.id]
  }

  egress {
    description = "Forward HTTPS to external providers"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_iam_policy_document" "ai_nat_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ai_nat" {
  name               = "${local.resource_prefix}-ai-nat"
  assume_role_policy = data.aws_iam_policy_document.ai_nat_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ai_nat_ssm" {
  role       = aws_iam_role.ai_nat.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ai_nat" {
  name = "${local.resource_prefix}-ai-nat"
  role = aws_iam_role.ai_nat.name
}

resource "aws_eip" "ai_egress" {
  domain = "vpc"
}

resource "aws_instance" "ai_nat" {
  ami                         = data.aws_ssm_parameter.ai_nat_instance_ami.value
  instance_type               = var.ai_nat_instance_type
  iam_instance_profile        = aws_iam_instance_profile.ai_nat.name
  subnet_id                   = aws_subnet.ai_egress_public.id
  vpc_security_group_ids      = [aws_security_group.ai_nat.id]
  source_dest_check           = false
  user_data_replace_on_change = true

  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y iptables-nft
    cat >/usr/local/sbin/transitforge-nat <<'EOF'
    #!/bin/bash
    set -euo pipefail
    network_interface=$(ip route show default | awk '{print $5; exit}')
    sysctl -w net.ipv4.ip_forward=1
    iptables -t nat -C POSTROUTING -o "$network_interface" -j MASQUERADE 2>/dev/null || \
      iptables -t nat -A POSTROUTING -o "$network_interface" -j MASQUERADE
    iptables -C FORWARD -s 10.84.1.0/24 -o "$network_interface" -j ACCEPT 2>/dev/null || \
      iptables -A FORWARD -s 10.84.1.0/24 -o "$network_interface" -j ACCEPT
    iptables -C FORWARD -d 10.84.1.0/24 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
      iptables -A FORWARD -d 10.84.1.0/24 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    EOF
    chmod 0755 /usr/local/sbin/transitforge-nat
    cat >/etc/systemd/system/transitforge-nat.service <<'EOF'
    [Unit]
    Description=TransitForge NAT forwarding
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=oneshot
    ExecStart=/usr/local/sbin/transitforge-nat
    RemainAfterExit=yes

    [Install]
    WantedBy=multi-user.target
    EOF
    systemctl daemon-reload
    systemctl enable --now transitforge-nat.service
    EOT

  depends_on = [aws_iam_role_policy_attachment.ai_nat_ssm]
}

resource "aws_eip_association" "ai_nat" {
  allocation_id = aws_eip.ai_egress.id
  instance_id   = aws_instance.ai_nat.id
}
