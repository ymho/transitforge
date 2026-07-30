import { describe, expect, it, vi } from "vitest";

import {
  invokeBedrockAgent,
  queryDailyCongestionPeak,
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

  it("requests a daily congestion peak through the protected endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          serviceDate: "2026-07-29",
          sampleCount: 64,
          peak: {
            collectedAt: "2026-07-29T08:15:00+00:00",
            sourceUpdatedAt: "2026-07-29T08:14:50+00:00",
            totalCongestion: 3_934,
            trainCount: 38,
            carCount: 291,
            topTrains: [
              { trainNumber: "1655H", totalCongestion: 240 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await queryDailyCongestionPeak("2026-07-29", fetcher);

    expect(result.peak?.totalCongestion).toBe(3_934);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "daily_congestion_peak",
      serviceDate: "2026-07-29",
    });
  });
});
