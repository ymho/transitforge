import gzip
import importlib.util
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

MODULE_PATH = (
    Path(__file__).parents[1]
    / "infra"
    / "lambda"
    / "train_monitor_collector"
    / "handler.py"
)
SPEC = importlib.util.spec_from_file_location("train_monitor_collector", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(collector)


class FakeS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


class ConditionalWriteError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class TrainMonitorCollectorTest(unittest.TestCase):
    def test_stores_partitioned_archive_and_latest_snapshot(self):
        body = json.dumps(
            {"update": "2026-07-29T08:15:00+09:00", "trains": {"123A": []}}
        ).encode()
        s3 = FakeS3()

        result = collector.collect(
            s3_client=s3,
            collected_at=datetime(2026, 7, 28, 23, 16, 0, tzinfo=timezone.utc),
            archive_bucket="archive",
            latest_bucket="website",
            latest_key="api/westjr/trainmonitorinfo.json",
            upstream_url="https://example.invalid/snapshot",
            fetch=lambda _: body,
        )

        self.assertEqual(len(s3.puts), 2)
        archive, latest = s3.puts
        self.assertEqual(archive["Bucket"], "archive")
        self.assertEqual(
            archive["Key"],
            "raw/year=2026/month=07/day=29/hour=08/"
            "collected_at=20260729T081600+0900.json.gz",
        )
        self.assertEqual(gzip.decompress(archive["Body"]), body)
        self.assertEqual(archive["ContentEncoding"], "gzip")
        self.assertEqual(latest["Bucket"], "website")
        self.assertEqual(latest["Key"], "api/westjr/trainmonitorinfo.json")
        self.assertEqual(latest["Body"], body)
        self.assertEqual(result["bytes"], len(body))

    def test_rejects_unexpected_upstream_shape_before_writing(self):
        s3 = FakeS3()

        with self.assertRaisesRegex(ValueError, "expected snapshot shape"):
            collector.store_snapshot(
                s3_client=s3,
                body=b'{"message": "maintenance"}',
                collected_at=datetime.now(timezone.utc),
                archive_bucket="archive",
                latest_bucket="website",
                latest_key="latest.json",
            )

        self.assertEqual(s3.puts, [])

    def test_claims_each_minute_only_once(self):
        class ClaimingS3(FakeS3):
            def __init__(self):
                super().__init__()
                self.keys = set()

            def put_object(self, **kwargs):
                if kwargs["Key"] in self.keys and kwargs.get("IfNoneMatch") == "*":
                    raise ConditionalWriteError("PreconditionFailed")
                self.keys.add(kwargs["Key"])
                super().put_object(**kwargs)

        s3 = ClaimingS3()
        collected_at = datetime(2026, 7, 28, 23, 16, 30, tzinfo=timezone.utc)

        self.assertTrue(
            collector.claim_collection_slot(s3, "archive", collected_at)
        )
        self.assertFalse(
            collector.claim_collection_slot(s3, "archive", collected_at)
        )
        self.assertEqual(
            s3.puts[0]["Key"],
            "claims/year=2026/month=07/day=29/slot=20260729T0816+0900",
        )


if __name__ == "__main__":
    unittest.main()
