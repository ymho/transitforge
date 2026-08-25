from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse


class SecretsManagerClient(Protocol):
    def get_secret_value(self, *, SecretId: str) -> dict[str, Any]: ...


@dataclass(frozen=True)
class TravelProviderCredentials:
    application_id: str
    access_key: str
    hotel_search_url: str
    affiliate_id: str | None = None


def load_travel_provider_credentials(
    secret_arn: str,
    secrets_manager_client: SecretsManagerClient,
) -> TravelProviderCredentials:
    if not isinstance(secret_arn, str) or not secret_arn:
        raise ValueError("旅行提供者のシークレットARNが設定されていません。")

    result = secrets_manager_client.get_secret_value(SecretId=secret_arn)
    secret_string = result.get("SecretString")
    if not isinstance(secret_string, str):
        raise ValueError("旅行提供者の認証情報が文字列ではありません。")

    try:
        value = json.loads(secret_string)
    except json.JSONDecodeError as error:
        raise ValueError("旅行提供者の認証情報はJSON形式にしてください。") from error

    if not isinstance(value, dict):
        raise ValueError("旅行提供者の認証情報はJSONオブジェクトにしてください。")
    application_id = value.get("application_id")
    access_key = value.get("access_key")
    hotel_search_url = value.get("hotel_search_url")
    affiliate_id = value.get("affiliate_id")
    if not isinstance(application_id, str) or not application_id.strip():
        raise ValueError("旅行提供者のapplication_idが必要です。")
    if not isinstance(access_key, str) or not access_key.strip():
        raise ValueError("旅行提供者のaccess_keyが必要です。")
    if not isinstance(hotel_search_url, str) or not _is_https_url(hotel_search_url):
        raise ValueError("旅行提供者のhotel_search_urlはHTTPS URLにしてください。")
    if affiliate_id is not None and (not isinstance(affiliate_id, str) or not affiliate_id.strip()):
        raise ValueError("旅行提供者のaffiliate_idは空でない文字列にしてください。")

    return TravelProviderCredentials(
        application_id=application_id.strip(),
        access_key=access_key.strip(),
        hotel_search_url=hotel_search_url,
        affiliate_id=affiliate_id.strip() if isinstance(affiliate_id, str) else None,
    )


def _is_https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc) and not parsed.username and not parsed.password
