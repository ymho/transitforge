import { describe, expect, it } from "vitest";

import { createAgentApplication } from "./composition-root.js";

describe("createAgentApplication", () => {
  it("既存operationに必要な環境変数を検証してApplicationを構成する", () => {
    expect(createAgentApplication({
      MODEL_ID: "model", SUMMARY_TABLE: "summary", DELAY_SUMMARY_TABLE: "delay",
      AI_TIMETABLE_BUCKET: "timetable", AI_TIMETABLE_PREFIX: "ai-timetable", PLANNING_TIMETABLE_PREFIX: "timetable",
      TRAFFIC_SNAPSHOT_BUCKET: "traffic", TRAFFIC_SNAPSHOT_KEY: "api/traffic/delays.json",
      TRAVEL_PROVIDER_SECRET_ARN: "arn:secret", CONVERSATION_FEEDBACK_BUCKET: "feedback", AGENT_TRACE_BUCKET: "trace",
      VIEWER_ORIGIN: "https://app.ohmyki.com",
    })).toBeInstanceOf(Object);
  });

  it("必須環境変数がない構成を拒否する", () => {
    expect(() => createAgentApplication({})).toThrow("AI_TIMETABLE_BUCKET is required");
  });
});
