import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class NotificationInfrastructureTest(unittest.TestCase):
    def test_separate_durable_table_shared_worker_and_dlq(self):
        tf = (ROOT / "infra/terraform/environments/dev/notifications.tf").read_text()
        for token in ['"notification-due"', '"KEYS_ONLY"', 'point_in_time_recovery', 'deletion_protection_enabled = true', 'rate(1 minute)', 'maximum_retry_attempts', '1209600', 'notification_tick_dlq', 'PollSuccess']:
            self.assertIn(token, tf)
        self.assertNotIn('aws_lambda_function_url', tf)
        self.assertNotIn('dynamodb:Scan', tf)
        self.assertNotIn('sns:Publish', tf)
        self.assertNotIn('bedrock:InvokeModel', tf)
        self.assertIn('dynamodb:EnclosingOperation', tf)
        self.assertIn('dynamodb:Attributes', tf)
        for name in ['rail-impact.tf', 'trip-recheck.tf']:
            self.assertIn('NOTIFICATION_TABLE_NAME', (ROOT / 'infra/terraform/environments/dev' / name).read_text())

    def test_agent_cannot_trigger_or_read_notifications_without_principal(self):
        source = (ROOT / 'backend/agent-api/src/lambda.ts').read_text()
        self.assertIn('createNotificationHandler()', source)
        self.assertNotIn('NotificationWorker', source)
        app = (ROOT / 'backend/agent-api/src/usecases/notification-application.ts').read_text()
        self.assertNotIn('console.', app)
        self.assertNotIn('bookingReference', app)
        self.assertNotIn('invokeModel', app)

    def test_deploy_artifact_and_actual_tick_validation(self):
        manifest = json.loads((ROOT / 'infra/packaging/notification.json').read_text())
        self.assertEqual(manifest['runtime'], 'nodejs22.x')
        self.assertEqual(manifest['handler'], 'index.handler')
        scripts = json.loads((ROOT / 'backend/agent-api/package.json').read_text())['scripts']
        self.assertIn('bundle:notification', scripts['build'])
        source = (ROOT / 'backend/agent-api/src/notification-lambda.ts').read_text()
        self.assertIn('trustedTick(event, process.env.NOTIFICATION_RULE_ARN', source)
        self.assertNotIn('JSON.stringify(event)', source)
