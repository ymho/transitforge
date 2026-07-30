import gzip
import importlib.util
import json
import unittest
from io import BytesIO
from datetime import datetime, timezone
from decimal import Decimal
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


class FakeDynamoDB:
    def __init__(self):
        self.puts = []

    def put_item(self, **kwargs):
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
        dynamodb = FakeDynamoDB()

        result = collector.collect(
            s3_client=s3,
            dynamodb_client=dynamodb,
            collected_at=datetime(2026, 7, 28, 23, 16, 0, tzinfo=timezone.utc),
            archive_bucket="archive",
            latest_bucket="website",
            latest_key="api/westjr/trainmonitorinfo.json",
            summary_table="summaries",
            summary_retention_days=730,
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
        self.assertEqual(len(dynamodb.puts), 1)
        self.assertEqual(
            dynamodb.puts[0]["Item"]["serviceDate"],
            {"S": "2026-07-29"},
        )

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

    def test_summarizes_the_same_per_car_totals_as_the_viewer(self):
        snapshot = {
            "update": "2026-07-29T08:15:00+09:00",
            "trains": {
                "123A": [
                    {
                        "cars": [
                            {"congestion": 8},
                            {"congestion": 4},
                            {"congestion": -1},
                        ]
                    }
                ],
                "456B": [{"cars": [{"congestion": 20}, {"status": 1}]}],
                "invalid": "not-a-consist",
            },
        }

        summary = collector.congestion_summary(
            snapshot,
            datetime(2026, 7, 28, 23, 16, tzinfo=timezone.utc),
            730,
        )

        self.assertEqual(summary["serviceDate"], "2026-07-29")
        self.assertEqual(summary["totalCongestion"], Decimal(32))
        self.assertEqual(summary["trainTotals"], {
            "123A": Decimal(12),
            "456B": Decimal(20),
        })
        self.assertEqual(summary["trainCount"], 2)
        self.assertEqual(summary["carCount"], 3)

    def test_backfills_existing_gzip_snapshots_for_a_date(self):
        body = json.dumps(
            {
                "update": "2026-07-29T08:15:00+09:00",
                "trains": {"123A": [{"cars": [{"congestion": 8}]}]},
            }
        ).encode()

        class ArchiveS3(FakeS3):
            def list_objects_v2(self, **kwargs):
                return {
                    "Contents": [
                        {
                            "Key": (
                                "raw/year=2026/month=07/day=29/hour=08/"
                                "collected_at=20260729T081600+0900.json.gz"
                            )
                        }
                    ]
                }

            def get_object(self, **kwargs):
                return {
                    "Body": BytesIO(gzip.compress(body)),
                    "Metadata": {
                        "collected-at": "2026-07-28T23:16:00+00:00"
                    },
                }

        dynamodb = FakeDynamoDB()
        result = collector.backfill_summaries(
            s3_client=ArchiveS3(),
            dynamodb_client=dynamodb,
            archive_bucket="archive",
            summary_table="summaries",
            service_date="2026-07-29",
            summary_retention_days=730,
        )

        self.assertEqual(result, {"serviceDate": "2026-07-29", "processed": 1})
        self.assertEqual(
            dynamodb.puts[0]["Item"]["totalCongestion"],
            {"N": "8"},
        )


if __name__ == "__main__":
    unittest.main()
