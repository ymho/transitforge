import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEV_TERRAFORM = ROOT / "infra" / "terraform" / "environments" / "dev"


class AiNatBootstrapTest(unittest.TestCase):
    def test_uses_nano_as_the_default_instance_type(self) -> None:
        variables = (DEV_TERRAFORM / "variables.tf").read_text(encoding="utf-8")
        block = variables.split('variable "ai_nat_instance_type" {', 1)[1].split(
            'variable "github_repository" {', 1
        )[0]

        self.assertRegex(block, re.compile(r'default\s*=\s*"t4g\.nano"'))

    def test_enables_persistent_swap_before_installing_nat_package(self) -> None:
        source = (DEV_TERRAFORM / "ai-egress.tf").read_text(encoding="utf-8")
        swap_create = source.index('fallocate -l 512M "$swap_file"')
        swap_enable = source.index('swapon "$swap_file"')
        swap_persist = source.index('echo "$swap_file none swap sw 0 0" >>/etc/fstab')
        package_install = source.index("dnf install -y iptables-nft")

        self.assertLess(swap_create, swap_enable)
        self.assertLess(swap_enable, swap_persist)
        self.assertLess(swap_persist, package_install)
        self.assertIn("systemctl enable --now transitforge-nat.service", source)


if __name__ == "__main__":
    unittest.main()
