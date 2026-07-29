import { describe, expect, it, vi } from "vitest";

import {
  invokeBedrockAgent,
  sha256Hex,
  type BedrockAgentResponse,
} from "./bedrock-agent";

describe("Bedrock agent client", () => {
  it("sends the payload hash required by a CloudFront Lambda origin", async () => {
    const bedrockResponse: BedrockAgentResponse = {
      message: {
        role: "assistant",
        content: [{ text: "案内しました。" }],
      },
      stopReason: "end_turn",
    };
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(bedrockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await invokeBedrockAgent(
      [{ role: "user", content: [{ text: "京都行きを見せて" }] }],
      fetcher,
    );

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/agent");
    expect(init?.method).toBe("POST");
    expect(
      new Headers(init?.headers).get("X-Amz-Content-Sha256"),
    ).toBe(await sha256Hex(String(init?.body)));
  });

  it("rejects an unexpected response shape", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message: "unexpected" }), { status: 200 }),
    );

    await expect(
      invokeBedrockAgent(
        [{ role: "user", content: [{ text: "案内して" }] }],
        fetcher,
      ),
    ).rejects.toThrow("不正な応答");
  });
});
