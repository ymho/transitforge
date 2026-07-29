from __future__ import annotations

import gzip
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen

JST = timezone(timedelta(hours=9))
DEFAULT_UPSTREAM_URL = (
    "https://www.train-guide.westjr.co.jp/api/v3/trainmonitorinfo.json"
)


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
    collected_at: datetime,
    archive_bucket: str,
    latest_bucket: str,
    latest_key: str,
    upstream_url: str,
    fetch: Callable[[str], bytes] = fetch_snapshot,
) -> dict[str, Any]:
    body = fetch(upstream_url)
    key = store_snapshot(
        s3_client=s3_client,
        body=body,
        collected_at=collected_at,
        archive_bucket=archive_bucket,
        latest_bucket=latest_bucket,
        latest_key=latest_key,
    )
    return {
        "archiveKey": key,
        "bytes": len(body),
        "collectedAt": collected_at.astimezone(timezone.utc).isoformat(),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    import boto3

    s3_client = boto3.client("s3")
    collected_at = datetime.now(timezone.utc)
    archive_bucket = os.environ["ARCHIVE_BUCKET"]
    if not claim_collection_slot(s3_client, archive_bucket, collected_at):
        return {
            "collectedAt": collected_at.isoformat(),
            "skipped": "collection slot already claimed",
        }

    return collect(
        s3_client=s3_client,
        collected_at=collected_at,
        archive_bucket=archive_bucket,
        latest_bucket=os.environ["LATEST_BUCKET"],
        latest_key=os.environ["LATEST_KEY"],
        upstream_url=os.environ.get("UPSTREAM_URL", DEFAULT_UPSTREAM_URL),
    )
