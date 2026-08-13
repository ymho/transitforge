import importlib.util
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "tools" / "backfill_analytics.py"
SPEC = importlib.util.spec_from_file_location("backfill_analytics", MODULE_PATH)
backfill = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(backfill)


class BackfillAnalyticsTest(unittest.TestCase):
    def test_builds_an_inclusive_date_range(self):
        self.assertEqual(
            backfill.service_dates(date(2026, 8, 1), date(2026, 8, 3)),
            [date(2026, 8, 1), date(2026, 8, 2), date(2026, 8, 3)],
        )

    def test_follows_lambda_continuation_tokens_until_complete(self):
        with patch.object(
            backfill,
            "invoke_backfill_page",
            side_effect=[
                {"processed": 100, "nextContinuationToken": "page-2"},
                {"processed": 42},
            ],
        ) as invoke:
            processed = backfill.backfill_date(
                "delay",
                date(2026, 8, 1),
                "transitforge-dev",
                "ap-northeast-1",
                100,
            )

        self.assertEqual(processed, 142)
        self.assertIsNone(invoke.call_args_list[0].args[-1])
        self.assertEqual(invoke.call_args_list[1].args[-1], "page-2")


if __name__ == "__main__":
    unittest.main()
