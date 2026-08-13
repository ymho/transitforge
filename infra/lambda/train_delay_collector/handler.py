from __future__ import annotations

import gzip
import json
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen

JST = timezone(timedelta(hours=9))
DEFAULT_UPSTREAM_BASE_URL = "https://www.train-guide.westjr.co.jp/api/v3"
SOURCE_IDS = (
    "hokuriku",
    "kobesanyo",
    "hokurikubiwako",
    "kyoto",
    "ako",
    "kosei",
    "kusatsu",
    "nara",
    "sagano",
    "sanin1",
    "sanin2",
    "osakahigashi",
    "takarazuka",
    "osakaloop",
    "gakkentoshi",
    "tozai",
    "hanwahagoromo",
    "yumesaki",
    "yamatoji",
    "yamatojiosakahigashi",
    "kansaiairport",
    "wakayama1",
    "kinokuni",
    "manyomahoroba",
    "kansai",
    "bantan",
)
MAX_FETCH_WORKERS = 4
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEFAULT_BACKFILL_PAGE_SIZE = 100


def source_urls(base_url: str = DEFAULT_UPSTREAM_BASE_URL) -> dict[str, str]:
    normalized_base = base_url.rstrip("/")
    return {source_id: f"{normalized_base}/{source_id}.json" for source_id in SOURCE_IDS}


def fetch_snapshot(url: str, timeout_seconds: int = 8) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "TransitForge/1.0 (+scheduled-delay-cache)",
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
        or not isinstance(value.get("trains"), list)
    ):
        raise ValueError("upstream response does not match the expected delay shape")
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


def claim_collection_slot(s3_client: Any, bucket: str, collected_at: datetime) -> bool:
    try:
        s3_client.put_object(
            Bucket=bucket,
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


def delay_minutes(raw_train: dict[str, Any]) -> int | float | None:
    raw_delay = raw_train.get("delayMinutes", raw_train.get("delayMinites"))
    if (
        isinstance(raw_delay, bool)
        or not isinstance(raw_delay, (int, float))
        or not math.isfinite(raw_delay)
        or raw_delay < 0
    ):
        return None
    if isinstance(raw_delay, int) or raw_delay.is_integer():
        return int(raw_delay)
    return raw_delay


def normalized_snapshot(
    snapshots: dict[str, dict[str, Any]],
    failures: dict[str, str],
    collected_at: datetime,
) -> dict[str, Any]:
    trains: dict[str, dict[str, Any]] = {}
    for source_id, snapshot in sorted(snapshots.items()):
        for raw_train in snapshot["trains"]:
            if not isinstance(raw_train, dict):
                continue
            train_number = raw_train.get("no")
            delay = delay_minutes(raw_train)
            if not isinstance(train_number, str) or not train_number or delay is None:
                continue
            existing = trains.get(train_number)
            if existing is None:
                destination = raw_train.get("dest")
                trains[train_number] = {
                    "delayMinutes": delay,
                    "sources": [source_id],
                    "displayType": raw_train.get("displayType", ""),
                    "nickname": raw_train.get("nickname", ""),
                    "destination": (
                        destination.get("text", "")
                        if isinstance(destination, dict)
                        else ""
                    ),
                }
                continue
            existing["delayMinutes"] = max(existing["delayMinutes"], delay)
            if source_id not in existing["sources"]:
                existing["sources"].append(source_id)

    return {
        "collectedAt": collected_at.astimezone(timezone.utc).isoformat(),
        "sourceUpdates": {
            source_id: snapshot["update"]
            for source_id, snapshot in sorted(snapshots.items())
        },
        "failedSources": sorted(failures),
        "trains": trains,
    }


def delay_summary(
    snapshot: dict[str, Any],
    retention_days: int,
) -> dict[str, Any]:
    collected_at = datetime.fromisoformat(snapshot["collectedAt"])
    train_delays = {
        train_number: train["delayMinutes"]
        for train_number, train in snapshot["trains"].items()
        if train["delayMinutes"] > 0
    }
    return {
        "serviceDate": collected_at.astimezone(JST).date().isoformat(),
        "collectedAt": collected_at.astimezone(timezone.utc).isoformat(),
        "sourceCount": len(snapshot["sourceUpdates"]),
        "failureCount": len(snapshot["failedSources"]),
        "observedTrainCount": len(snapshot["trains"]),
        "delayedTrainCount": len(train_delays),
        "totalDelayMinutes": sum(train_delays.values()),
        "maximumDelayMinutes": max(train_delays.values(), default=0),
        "trainDelays": train_delays,
        "expiresAt": int(
            (collected_at.astimezone(timezone.utc) + timedelta(days=retention_days)).timestamp()
        ),
    }


def store_snapshot(
    s3_client: Any,
    raw_bundle: dict[str, Any],
    normalized: dict[str, Any],
    collected_at: datetime,
    archive_bucket: str,
    latest_bucket: str,
    latest_key: str,
) -> str:
    archive_body = json.dumps(
        raw_bundle, ensure_ascii=False, separators=(",", ":")
    ).encode()
    latest_body = json.dumps(
        normalized, ensure_ascii=False, separators=(",", ":")
    ).encode()
    key = archive_key(collected_at)
    metadata = {"collected-at": normalized["collectedAt"]}
    s3_client.put_object(
        Bucket=archive_bucket,
        Key=key,
        Body=gzip.compress(archive_body, compresslevel=6, mtime=0),
        ContentType="application/json",
        ContentEncoding="gzip",
        CacheControl="private, no-store",
        Metadata=metadata,
    )
    s3_client.put_object(
        Bucket=latest_bucket,
        Key=latest_key,
        Body=latest_body,
        ContentType="application/json; charset=utf-8",
        CacheControl="public, max-age=60, stale-if-error=300",
        Metadata=metadata,
    )
    return key


def store_delay_summary(
    dynamodb_client: Any,
    table_name: str,
    summary: dict[str, Any],
) -> None:
    dynamodb_client.put_item(
        TableName=table_name,
        Item={
            "serviceDate": {"S": summary["serviceDate"]},
            "collectedAt": {"S": summary["collectedAt"]},
            "sourceCount": {"N": str(summary["sourceCount"])},
            "failureCount": {"N": str(summary["failureCount"])},
            "observedTrainCount": {"N": str(summary["observedTrainCount"])},
            "delayedTrainCount": {"N": str(summary["delayedTrainCount"])},
            "totalDelayMinutes": {"N": str(summary["totalDelayMinutes"])},
            "maximumDelayMinutes": {"N": str(summary["maximumDelayMinutes"])},
            "trainDelays": {
                "M": {
                    train_number: {"N": str(delay)}
                    for train_number, delay in summary["trainDelays"].items()
                }
            },
            "expiresAt": {"N": str(summary["expiresAt"])},
        },
    )


def backfill_summaries(
    s3_client: Any,
    dynamodb_client: Any,
    archive_bucket: str,
    summary_table: str,
    service_date: str,
    retention_days: int,
    continuation_token: str | None = None,
    page_size: int = DEFAULT_BACKFILL_PAGE_SIZE,
) -> dict[str, Any]:
    if not DATE_PATTERN.fullmatch(service_date):
        raise ValueError("backfill date must use YYYY-MM-DD")
    parsed_date = datetime.strptime(service_date, "%Y-%m-%d")
    if not isinstance(page_size, int) or isinstance(page_size, bool):
        raise ValueError("backfill page size must be an integer")
    prefix = (
        f"raw/year={parsed_date:%Y}/month={parsed_date:%m}/"
        f"day={parsed_date:%d}/"
    )
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
        raw_bundle = json.loads(gzip.decompress(stored["Body"].read()))
        if not isinstance(raw_bundle, dict):
            raise ValueError(f"archive object is not a JSON object: {key}")
        collected_at_text = raw_bundle.get("collectedAt")
        snapshots = raw_bundle.get("sources")
        failures = raw_bundle.get("failures")
        if (
            not isinstance(collected_at_text, str)
            or not isinstance(snapshots, dict)
            or not isinstance(failures, dict)
        ):
            raise ValueError(f"archive object has an invalid delay bundle: {key}")
        collected_at = datetime.fromisoformat(collected_at_text)
        validated_snapshots = {
            source_id: validate_snapshot(
                json.dumps(snapshot, ensure_ascii=False).encode()
            )
            for source_id, snapshot in snapshots.items()
            if isinstance(source_id, str)
        }
        normalized = normalized_snapshot(
            validated_snapshots,
            {str(source_id): str(error) for source_id, error in failures.items()},
            collected_at,
        )
        store_delay_summary(
            dynamodb_client,
            summary_table,
            delay_summary(normalized, retention_days),
        )
        processed += 1
    next_token = listing.get("NextContinuationToken")
    return {
        "serviceDate": service_date,
        "processed": processed,
        **({"nextContinuationToken": next_token} if next_token else {}),
    }


def collect(
    s3_client: Any,
    dynamodb_client: Any,
    collected_at: datetime,
    archive_bucket: str,
    latest_bucket: str,
    latest_key: str,
    summary_table: str,
    retention_days: int,
    urls: dict[str, str],
    fetch: Callable[[str], bytes] = fetch_snapshot,
) -> dict[str, Any]:
    if len(set(urls.values())) != len(urls):
        raise ValueError("delay source URLs must be unique")

    snapshots: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(MAX_FETCH_WORKERS, len(urls))) as executor:
        pending = {executor.submit(fetch, url): source_id for source_id, url in urls.items()}
        for future in as_completed(pending):
            source_id = pending[future]
            try:
                snapshots[source_id] = validate_snapshot(future.result())
            except Exception as error:
                failures[source_id] = f"{type(error).__name__}: {error}"[:300]

    if not snapshots:
        raise RuntimeError("all delay sources failed")

    normalized = normalized_snapshot(snapshots, failures, collected_at)
    raw_bundle = {
        "collectedAt": normalized["collectedAt"],
        "sources": snapshots,
        "failures": failures,
    }
    key = store_snapshot(
        s3_client,
        raw_bundle,
        normalized,
        collected_at,
        archive_bucket,
        latest_bucket,
        latest_key,
    )
    summary = delay_summary(normalized, retention_days)
    store_delay_summary(dynamodb_client, summary_table, summary)
    return {
        "archiveKey": key,
        "collectedAt": normalized["collectedAt"],
        "sourceCount": summary["sourceCount"],
        "failureCount": summary["failureCount"],
        "observedTrainCount": summary["observedTrainCount"],
        "delayedTrainCount": summary["delayedTrainCount"],
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    import boto3

    s3_client = boto3.client("s3")
    collected_at = datetime.now(timezone.utc)
    archive_bucket = os.environ["ARCHIVE_BUCKET"]
    if event.get("mode") == "backfill":
        continuation_token = event.get("continuationToken")
        if continuation_token is not None and not isinstance(continuation_token, str):
            raise ValueError("backfill continuationToken must be a string")
        return backfill_summaries(
            s3_client=s3_client,
            dynamodb_client=boto3.client("dynamodb"),
            archive_bucket=archive_bucket,
            summary_table=os.environ["SUMMARY_TABLE"],
            service_date=event.get("date", ""),
            retention_days=int(os.environ["SUMMARY_RETENTION_DAYS"]),
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
        dynamodb_client=boto3.client("dynamodb"),
        collected_at=collected_at,
        archive_bucket=archive_bucket,
        latest_bucket=os.environ["LATEST_BUCKET"],
        latest_key=os.environ["LATEST_KEY"],
        summary_table=os.environ["SUMMARY_TABLE"],
        retention_days=int(os.environ["SUMMARY_RETENTION_DAYS"]),
        urls=source_urls(os.environ.get("UPSTREAM_BASE_URL", DEFAULT_UPSTREAM_BASE_URL)),
    )
