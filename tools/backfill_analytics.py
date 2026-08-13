#!/usr/bin/env python3
"""Rebuild retained analytics summaries from archived S3 snapshots."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


FUNCTIONS = {
    "congestion": "transitforge-dev-train-monitor-collector",
    "delay": "transitforge-dev-train-delay-collector",
}


def service_dates(start: date, end: date) -> list[date]:
    if end < start:
        raise ValueError("end date must not be before start date")
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def invoke_backfill_page(
    function_name: str,
    service_date: date,
    profile: str,
    region: str,
    page_size: int,
    continuation_token: str | None,
) -> dict[str, Any]:
    payload = {
        "mode": "backfill",
        "date": service_date.isoformat(),
        "pageSize": page_size,
        **(
            {"continuationToken": continuation_token}
            if continuation_token is not None
            else {}
        ),
    }
    with tempfile.NamedTemporaryFile() as output:
        completed = subprocess.run(
            [
                "aws",
                "lambda",
                "invoke",
                "--function-name",
                function_name,
                "--region",
                region,
                "--profile",
                profile,
                "--cli-binary-format",
                "raw-in-base64-out",
                "--payload",
                json.dumps(payload, separators=(",", ":")),
                output.name,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        invocation = json.loads(completed.stdout)
        response = json.loads(Path(output.name).read_text())
    if invocation.get("FunctionError") or "errorMessage" in response:
        raise RuntimeError(f"{function_name} failed: {response}")
    if not isinstance(response, dict):
        raise RuntimeError(f"{function_name} returned an invalid response")
    return response


def backfill_date(
    service: str,
    service_date: date,
    profile: str,
    region: str,
    page_size: int,
) -> int:
    processed = 0
    continuation_token: str | None = None
    while True:
        response = invoke_backfill_page(
            FUNCTIONS[service],
            service_date,
            profile,
            region,
            page_size,
            continuation_token,
        )
        page_processed = response.get("processed")
        if not isinstance(page_processed, int):
            raise RuntimeError(f"{service} returned an invalid processed count")
        processed += page_processed
        print(json.dumps({
            "service": service,
            "date": service_date.isoformat(),
            "processed": processed,
        }))
        next_token = response.get("nextContinuationToken")
        if next_token is None:
            return processed
        if not isinstance(next_token, str) or not next_token:
            raise RuntimeError(f"{service} returned an invalid continuation token")
        continuation_token = next_token


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", choices=["congestion", "delay"], required=True)
    parser.add_argument("--start-date", type=parse_date, required=True)
    parser.add_argument("--end-date", type=parse_date, required=True)
    parser.add_argument("--profile", default="transitforge-dev")
    parser.add_argument("--region", default="ap-northeast-1")
    parser.add_argument("--page-size", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.page_size <= 1_000:
        parser.error("--page-size must be between 1 and 1000")

    total = 0
    for target_date in service_dates(args.start_date, args.end_date):
        total += backfill_date(
            args.service,
            target_date,
            args.profile,
            args.region,
            args.page_size,
        )
    print(json.dumps({
        "service": args.service,
        "startDate": args.start_date.isoformat(),
        "endDate": args.end_date.isoformat(),
        "processed": total,
        "complete": True,
    }))


if __name__ == "__main__":
    main()
