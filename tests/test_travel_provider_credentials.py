from tests.bedrock_agent_test_support import *

from travel_provider_credentials import load_travel_provider_credentials


class FakeSecretsManager:
    def __init__(self, value: object) -> None:
        self.value = value
        self.secret_id: str | None = None

    def get_secret_value(self, *, SecretId: str) -> dict[str, object]:
        self.secret_id = SecretId
        return {"SecretString": self.value}


class TravelProviderCredentialsTest(unittest.TestCase):
    def test_loads_the_credentials_without_logging_the_secret_value(self) -> None:
        client = FakeSecretsManager(
            '{"application_id":"application-123","affiliate_id":"affiliate-456"}'
        )

        credentials = load_travel_provider_credentials("arn:secret:travel-provider", client)

        self.assertEqual(client.secret_id, "arn:secret:travel-provider")
        self.assertEqual(credentials.application_id, "application-123")
        self.assertEqual(credentials.affiliate_id, "affiliate-456")

    def test_accepts_an_application_id_without_affiliate_id(self) -> None:
        credentials = load_travel_provider_credentials(
            "arn:secret:travel-provider",
            FakeSecretsManager('{"application_id":"application-123"}'),
        )

        self.assertIsNone(credentials.affiliate_id)

    def test_rejects_missing_or_invalid_application_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "application_id"):
            load_travel_provider_credentials(
                "arn:secret:travel-provider", FakeSecretsManager('{"application_id":""}')
            )
        with self.assertRaisesRegex(ValueError, "JSON形式"):
            load_travel_provider_credentials("arn:secret:travel-provider", FakeSecretsManager("not-json"))
