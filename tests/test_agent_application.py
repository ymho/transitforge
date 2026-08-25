from __future__ import annotations

import unittest

from tests.agent_api_test_support import handler
from agent_application import (
    AgentApplicationConfig,
    AgentApplicationDependencies,
    execute,
)
from operation_dispatcher import OperationConfig


class AgentApplicationTest(unittest.TestCase):
    def test_executes_without_terraform_or_aws_sdk(self) -> None:
        calls: list[tuple[str, str]] = []

        def converse(_client, messages, model_id, request_id, tools, _log):
            calls.append((model_id, request_id))
            self.assertEqual(messages[0]["content"][0]["text"], "京都へ行きたい")
            self.assertIsNone(tools)
            return {"message": {"role": "assistant", "content": []}, "stopReason": "end_turn"}

        unavailable = lambda: self.fail("この経路ではAWS clientを生成しない")
        status, body = execute(
            {"messages": [{"role": "user", "content": [{"text": "京都へ行きたい"}]}]},
            "request-1",
            AgentApplicationConfig(
                model_id="test-model",
                operation=OperationConfig("", "", "", "", "", "", "", ""),
                conversation_feedback_bucket="",
                agent_trace_bucket="",
            ),
            AgentApplicationDependencies(
                s3_client=unavailable,
                dynamodb_client=unavailable,
                secrets_manager_client=unavailable,
                bedrock_client=lambda: object(),
                converse=converse,
            ),
            lambda event, request_id, **fields: None,
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["stopReason"], "end_turn")
        self.assertEqual(calls, [("test-model", "request-1")])


if __name__ == "__main__":
    unittest.main()
