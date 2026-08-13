import gzip
import importlib.util
import json
import unittest
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

MODULE_PATH = (
    Path(__file__).parents[1]
    / "infra"
    / "lambda"
    / "train_delay_collector"
    / "handler.py"
)
SPEC = importlib.util.spec_from_file_location("train_delay_collector", MODULE_PATH)
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


class TrainDelayCollectorTest(unittest.TestCase):
    def test_source_urls_are_unique_and_include_requested_lines(self):
        urls = collector.source_urls()

        self.assertEqual(len(urls), len(set(urls.values())))
        self.assertEqual(len(urls), 26)
        self.assertIn("kyoto", urls)
        self.assertIn("kobesanyo", urls)
        self.assertIn("hokuriku", urls)
        self.assertIn("bantan", urls)

    def test_collect_fetches_each_url_once_and_merges_duplicate_trains(self):
        source_bodies = {
            "https://example.invalid/kyoto.json": snapshot(
                "2026-07-31T08:36:00Z",
                [train("100A", 3), train("200B", 0)],
            ),
            "https://example.invalid/kobe.json": snapshot(
                "2026-07-31T08:36:10Z",
                [train("100A", 5), train("300C", 8)],
            ),
        }
        calls = []

        def fetch(url):
            calls.append(url)
            return source_bodies[url]

        s3 = FakeS3()
        dynamodb = FakeDynamoDB()
        result = collector.collect(
            s3_client=s3,
            dynamodb_client=dynamodb,
            collected_at=datetime(2026, 7, 31, 8, 37, tzinfo=timezone.utc),
            archive_bucket="delay-archive",
            latest_bucket="website",
            latest_key="api/westjr/delays.json",
            summary_table="delay-summary",
            retention_days=730,
            urls={
                "kyoto": "https://example.invalid/kyoto.json",
                "kobesanyo": "https://example.invalid/kobe.json",
            },
            fetch=fetch,
        )

        self.assertCountEqual(calls, source_bodies)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result["sourceCount"], 2)
        self.assertEqual(result["delayedTrainCount"], 2)
        self.assertEqual(len(s3.puts), 2)
        archived = json.loads(gzip.decompress(s3.puts[0]["Body"]))
        self.assertEqual(set(archived["sources"]), {"kyoto", "kobesanyo"})
        latest = json.loads(s3.puts[1]["Body"])
        self.assertEqual(latest["trains"]["100A"]["delayMinutes"], 5)
        self.assertEqual(
            latest["trains"]["100A"]["sources"],
            ["kobesanyo", "kyoto"],
        )
        item = dynamodb.puts[0]["Item"]
        self.assertEqual(item["trainDelays"]["M"]["100A"], {"N": "5"})
        self.assertEqual(item["totalDelayMinutes"], {"N": "13"})

    def test_partial_source_failure_is_saved_without_retry(self):
        calls = []

        def fetch(url):
            calls.append(url)
            if url.endswith("failed.json"):
                raise TimeoutError("timed out")
            return snapshot("2026-07-31T08:36:00Z", [train("100A", 2)])

        s3 = FakeS3()
        result = collector.collect(
            s3_client=s3,
            dynamodb_client=FakeDynamoDB(),
            collected_at=datetime(2026, 7, 31, 8, 37, tzinfo=timezone.utc),
            archive_bucket="archive",
            latest_bucket="website",
            latest_key="latest.json",
            summary_table="summary",
            retention_days=30,
            urls={
                "ok": "https://example.invalid/ok.json",
                "failed": "https://example.invalid/failed.json",
            },
            fetch=fetch,
        )

        self.assertEqual(len(calls), 2)
        self.assertEqual(result["sourceCount"], 1)
        self.assertEqual(result["failureCount"], 1)
        latest = json.loads(s3.puts[1]["Body"])
        self.assertEqual(latest["failedSources"], ["failed"])

    def test_accepts_legacy_misspelled_delay_field(self):
        self.assertEqual(collector.delay_minutes({"delayMinites": 4}), 4)
        self.assertIsNone(collector.delay_minutes({"delayMinutes": -1}))

    def test_backfills_delay_summaries_from_raw_archives_one_page_at_a_time(self):
        raw_bundle = {
            "collectedAt": "2026-08-01T00:15:00+00:00",
            "sources": {
                "kyoto": json.loads(snapshot(
                    "2026-08-01T00:14:55Z",
                    [train("100A", 3), train("200B", 0)],
                )),
                "kobesanyo": json.loads(snapshot(
                    "2026-08-01T00:14:57Z",
                    [train("100A", 5)],
                )),
            },
            "failures": {"nara": "TimeoutError: timed out"},
        }

        class ArchiveS3(FakeS3):
            def list_objects_v2(self, **kwargs):
                self.list_request = kwargs
                return {
                    "Contents": [{"Key": "raw/example.json.gz"}],
                    "NextContinuationToken": "next-page",
                }

            def get_object(self, **kwargs):
                return {
                    "Body": BytesIO(gzip.compress(json.dumps(raw_bundle).encode()))
                }

        archive = ArchiveS3()
        dynamodb = FakeDynamoDB()
        result = collector.backfill_summaries(
            s3_client=archive,
            dynamodb_client=dynamodb,
            archive_bucket="delay-archive",
            summary_table="delay-summary",
            service_date="2026-08-01",
            retention_days=730,
            continuation_token="current-page",
            page_size=25,
        )

        self.assertEqual(archive.list_request["ContinuationToken"], "current-page")
        self.assertEqual(archive.list_request["MaxKeys"], 25)
        self.assertEqual(result, {
            "serviceDate": "2026-08-01",
            "processed": 1,
            "nextContinuationToken": "next-page",
        })
        item = dynamodb.puts[0]["Item"]
        self.assertEqual(item["failureCount"], {"N": "1"})
        self.assertEqual(item["trainDelays"]["M"]["100A"], {"N": "5"})


def snapshot(updated_at, trains):
    return json.dumps({"update": updated_at, "trains": trains}).encode()


def train(number, delay):
    return {
        "no": number,
        "delayMinutes": delay,
        "displayType": "新快速",
        "nickname": "",
        "dest": {"text": "姫路"},
    }


if __name__ == "__main__":
    unittest.main()
