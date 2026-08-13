from __future__ import annotations

import gzip
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable
from urllib.request import Request, urlopen

JST = timezone(timedelta(hours=9))
DEFAULT_UPSTREAM_URL = (
    "https://www.train-guide.westjr.co.jp/api/v3/trainmonitorinfo.json"
)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEFAULT_BACKFILL_PAGE_SIZE = 100


def fetch_snapshot(url: str, timeout_seconds: int = 10) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "TransitForge/1.0 (+scheduled-cache)",
        },
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        if response.status != 200:
            raise RuntimeError(f"upstream returned HTTP {response.status}")
        body = response.read()

    validate_snapshot(body)
    return body


def validate_snapshot(body: bytes) -> dict[str, Any]:
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("upstream response is not valid JSON") from error

    if (
        not isinstance(value, dict)
        or not isinstance(value.get("update"), str)
        or not isinstance(value.get("trains"), dict)
    ):
        raise ValueError("upstream response does not match the expected snapshot shape")
    return value


def archive_key(collected_at: datetime) -> str:
    collected_jst = collected_at.astimezone(JST)
    return (
        f"raw/year={collected_jst:%Y}/month={collected_jst:%m}/"
        f"day={collected_jst:%d}/hour={collected_jst:%H}/"
        f"collected_at={collected_jst:%Y%m%dT%H%M%S%z}.json.gz"
    )


def claim_key(collected_at: datetime) -> str:
    collected_jst = collected_at.astimezone(JST)
    return (
        f"claims/year={collected_jst:%Y}/month={collected_jst:%m}/"
        f"day={collected_jst:%d}/slot={collected_jst:%Y%m%dT%H%M%z}"
    )


def claim_collection_slot(
    s3_client: Any,
    archive_bucket: str,
    collected_at: datetime,
) -> bool:
    try:
        s3_client.put_object(
            Bucket=archive_bucket,
            Key=claim_key(collected_at),
            Body=b"",
            ContentType="application/octet-stream",
            CacheControl="private, no-store",
            IfNoneMatch="*",
        )
    except Exception as error:
        response = getattr(error, "response", {})
        error_code = response.get("Error", {}).get("Code")
        if error_code in {"PreconditionFailed", "ConditionalRequestConflict"}:
            return False
        raise
    return True


def congestion_summary(
    snapshot: dict[str, Any],
    collected_at: datetime,
    retention_days: int,
) -> dict[str, Any]:
    train_totals: dict[str, Decimal] = {}
    car_count = 0

    for train_number, raw_consists in snapshot["trains"].items():
        if not isinstance(train_number, str) or not isinstance(raw_consists, list):
            continue
        train_total = Decimal(0)
        observed_cars = 0
        for raw_consist in raw_consists:
            if not isinstance(raw_consist, dict):
                continue
            raw_cars = raw_consist.get("cars")
            if not isinstance(raw_cars, list):
                continue
            for raw_car in raw_cars:
                if not isinstance(raw_car, dict):
                    continue
                raw_congestion = raw_car.get("congestion")
                if (
                    isinstance(raw_congestion, bool)
                    or not isinstance(raw_congestion, (int, float))
                    or not math.isfinite(raw_congestion)
                    or raw_congestion < 0
                ):
                    continue
                train_total += Decimal(str(raw_congestion))
                observed_cars += 1
        if observed_cars > 0:
            train_totals[train_number] = train_total
            car_count += observed_cars

    collected_utc = collected_at.astimezone(timezone.utc)
    return {
        "serviceDate": collected_at.astimezone(JST).date().isoformat(),
        "collectedAt": collected_utc.isoformat(),
        "sourceUpdatedAt": snapshot["update"],
        "totalCongestion": sum(train_totals.values(), Decimal(0)),
        "trainCount": len(train_totals),
        "carCount": car_count,
        "trainTotals": train_totals,
        "expiresAt": int(
            (collected_utc + timedelta(days=retention_days)).timestamp()
        ),
    }


def store_congestion_summary(
    dynamodb_client: Any,
    summary_table: str,
    summary: dict[str, Any],
) -> None:
    dynamodb_client.put_item(
        TableName=summary_table,
        Item={
            "serviceDate": {"S": summary["serviceDate"]},
            "collectedAt": {"S": summary["collectedAt"]},
            "sourceUpdatedAt": {"S": summary["sourceUpdatedAt"]},
            "totalCongestion": {"N": str(summary["totalCongestion"])},
            "trainCount": {"N": str(summary["trainCount"])},
            "carCount": {"N": str(summary["carCount"])},
            "trainTotals": {
                "M": {
                    train_number: {"N": str(total)}
                    for train_number, total in summary["trainTotals"].items()
                }
            },
            "expiresAt": {"N": str(summary["expiresAt"])},
        },
    )


def store_snapshot(
    s3_client: Any,
    body: bytes,
    collected_at: datetime,
    archive_bucket: str,
    latest_bucket: str,
    latest_key: str,
) -> str:
    snapshot = validate_snapshot(body)
    key = archive_key(collected_at)
    collected_at_text = collected_at.astimezone(timezone.utc).isoformat()
    source_updated_at = snapshot["update"]

    s3_client.put_object(
        Bucket=archive_bucket,
        Key=key,
        Body=gzip.compress(body, compresslevel=6, mtime=0),
        ContentType="application/json",
        ContentEncoding="gzip",
        CacheControl="private, no-store",
        Metadata={
            "collected-at": collected_at_text,
            "source-updated-at": source_updated_at,
        },
    )
    s3_client.put_object(
        Bucket=latest_bucket,
        Key=latest_key,
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl="public, max-age=60, stale-if-error=300",
        Metadata={
            "collected-at": collected_at_text,
            "source-updated-at": source_updated_at,
        },
    )
    return key


def collect(
    s3_client: Any,
    dynamodb_client: Any,
    collected_at: datetime,
    archive_bucket: str,
    latest_bucket: str,
    latest_key: str,
    summary_table: str,
    summary_retention_days: int,
    upstream_url: str,
    fetch: Callable[[str], bytes] = fetch_snapshot,
) -> dict[str, Any]:
    body = fetch(upstream_url)
    summary = congestion_summary(
        validate_snapshot(body),
        collected_at,
        summary_retention_days,
    )
    key = store_snapshot(
        s3_client=s3_client,
        body=body,
        collected_at=collected_at,
        archive_bucket=archive_bucket,
        latest_bucket=latest_bucket,
        latest_key=latest_key,
    )
    store_congestion_summary(dynamodb_client, summary_table, summary)
    return {
        "archiveKey": key,
        "bytes": len(body),
        "collectedAt": collected_at.astimezone(timezone.utc).isoformat(),
        "totalCongestion": number_for_response(summary["totalCongestion"]),
        "trainCount": summary["trainCount"],
    }


def backfill_summaries(
    s3_client: Any,
    dynamodb_client: Any,
    archive_bucket: str,
    summary_table: str,
    service_date: str,
    summary_retention_days: int,
    continuation_token: str | None = None,
    page_size: int = DEFAULT_BACKFILL_PAGE_SIZE,
) -> dict[str, Any]:
    if not DATE_PATTERN.fullmatch(service_date):
        raise ValueError("backfill date must use YYYY-MM-DD")
    parsed_date = datetime.strptime(service_date, "%Y-%m-%d")
    prefix = (
        f"raw/year={parsed_date:%Y}/month={parsed_date:%m}/"
        f"day={parsed_date:%d}/"
    )
    if not isinstance(page_size, int) or isinstance(page_size, bool):
        raise ValueError("backfill page size must be an integer")
    request: dict[str, Any] = {
        "Bucket": archive_bucket,
        "Prefix": prefix,
        "MaxKeys": max(1, min(1_000, page_size)),
    }
    if continuation_token:
        request["ContinuationToken"] = continuation_token
    listing = s3_client.list_objects_v2(**request)
    processed = 0
    for entry in listing.get("Contents", []):
        key = entry.get("Key")
        if not isinstance(key, str) or not key.endswith(".json.gz"):
            continue
        stored = s3_client.get_object(Bucket=archive_bucket, Key=key)
        body = gzip.decompress(stored["Body"].read())
        metadata = stored.get("Metadata", {})
        collected_at_text = metadata.get("collected-at")
        if not isinstance(collected_at_text, str):
            raise ValueError(f"archive object lacks collected-at metadata: {key}")
        collected_at = datetime.fromisoformat(collected_at_text)
        summary = congestion_summary(
            validate_snapshot(body),
            collected_at,
            summary_retention_days,
        )
        store_congestion_summary(dynamodb_client, summary_table, summary)
        processed += 1
    next_token = listing.get("NextContinuationToken")
    return {
        "serviceDate": service_date,
        "processed": processed,
        **({"nextContinuationToken": next_token} if next_token else {}),
    }


def number_for_response(value: Decimal) -> int | float:
    integral = value.to_integral_value()
    return int(integral) if value == integral else float(value)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    import boto3

    s3_client = boto3.client("s3")
    dynamodb_client = boto3.client("dynamodb")
    collected_at = datetime.now(timezone.utc)
    archive_bucket = os.environ["ARCHIVE_BUCKET"]
    summary_table = os.environ["SUMMARY_TABLE"]
    summary_retention_days = int(os.environ["SUMMARY_RETENTION_DAYS"])
    if event.get("mode") == "backfill":
        continuation_token = event.get("continuationToken")
        if continuation_token is not None and not isinstance(continuation_token, str):
            raise ValueError("backfill continuationToken must be a string")
        return backfill_summaries(
            s3_client=s3_client,
            dynamodb_client=dynamodb_client,
            archive_bucket=archive_bucket,
            summary_table=summary_table,
            service_date=event.get("date", ""),
            summary_retention_days=summary_retention_days,
            continuation_token=continuation_token,
            page_size=event.get("pageSize", DEFAULT_BACKFILL_PAGE_SIZE),
        )
    if not claim_collection_slot(s3_client, archive_bucket, collected_at):
        return {
            "collectedAt": collected_at.isoformat(),
            "skipped": "collection slot already claimed",
        }

    return collect(
        s3_client=s3_client,
        dynamodb_client=dynamodb_client,
        collected_at=collected_at,
        archive_bucket=archive_bucket,
        latest_bucket=os.environ["LATEST_BUCKET"],
        latest_key=os.environ["LATEST_KEY"],
        summary_table=summary_table,
        summary_retention_days=summary_retention_days,
        upstream_url=os.environ.get("UPSTREAM_URL", DEFAULT_UPSTREAM_URL),
    )
