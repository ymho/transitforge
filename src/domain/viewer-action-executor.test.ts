import { describe, expect, it, vi } from "vitest";

import { AgentTraceRecorder } from "./agent/agent-trace";
import { ViewerActionExecutor } from "./viewer-action-executor";
import { ViewerActionTaskScope } from "./viewer-action-policy";

describe("ViewerActionExecutor", () => {
  it("applies only verified task entities and records proposed and applied events", () => {
    const ports = fixturePorts();
    const executor = new ViewerActionExecutor(ports, 2_880);
    const scope = fixtureScope();
    const trace = new AgentTraceRecorder("execution-1");

    expect(executor.execute(
      { type: "focus_train", serviceUid: "service-1" },
      scope,
      trace,
    )).toMatchObject({ ok: true, effect: "display_only" });
    expect(executor.execute(
      { type: "highlight_route", journeyId: "journey-1" },
      scope,
      trace,
    )).toMatchObject({ ok: true });
    expect(executor.execute(
      { type: "compare_journeys", journeyIds: ["journey-1", "journey-2"] },
      scope,
      trace,
    )).toMatchObject({ ok: true });
    expect(executor.execute(
      { type: "show_evidence", evidenceIds: ["evidence-1"] },
      scope,
      trace,
    )).toMatchObject({ ok: true });

    expect(ports.focusTrain).toHaveBeenCalledWith("service-1");
    expect(ports.highlightRoute).toHaveBeenCalledWith("journey-1");
    expect(ports.compareJourneys).toHaveBeenCalledWith(["journey-1", "journey-2"]);
    expect(ports.showEvidence).toHaveBeenCalledWith(["evidence-1"]);
    expect(trace.snapshot().events.map((event) =>
      event.type === "viewer_action" ? event.status : event.type)).toEqual([
      "proposed", "applied",
      "proposed", "applied",
      "proposed", "applied",
      "proposed", "applied",
    ]);
  });

  it("rejects unknown actions invalid time and unrelated entities before calling ports", () => {
    const ports = fixturePorts();
    const executor = new ViewerActionExecutor(ports, 1_500);
    const scope = fixtureScope();
    const trace = new AgentTraceRecorder("execution-1");

    expect(executor.execute(
      { type: "open_url", url: "https://example.com" },
      scope,
      trace,
    )).toMatchObject({ ok: false, code: "invalid_action" });
    expect(executor.execute(
      { type: "set_display_time", routeTimeMinutes: 1_501 },
      scope,
      trace,
    )).toMatchObject({ ok: false, code: "invalid_time" });
    expect(executor.execute(
      { type: "focus_train", serviceUid: "other-service" },
      scope,
      trace,
    )).toMatchObject({ ok: false, code: "entity_out_of_scope" });
    expect(executor.execute(
      { type: "show_evidence", evidenceIds: ["other-evidence"] },
      scope,
      trace,
    )).toMatchObject({ ok: false, code: "entity_out_of_scope" });

    expect(ports.setDisplayTime).not.toHaveBeenCalled();
    expect(ports.focusTrain).not.toHaveBeenCalled();
    const rejected = trace.snapshot().events.filter((event) =>
      event.type === "viewer_action" && event.status === "rejected");
    expect(rejected).toHaveLength(4);
    expect(rejected.at(-1)).toMatchObject({
      reason: "表示対象に未検証のEvidenceが含まれています",
    });
  });

  it("rejects a scope created for another execution", () => {
    const ports = fixturePorts();
    const executor = new ViewerActionExecutor(ports, 2_880);
    const trace = new AgentTraceRecorder("execution-2");

    const output = executor.execute(
      { type: "focus_train", serviceUid: "service-1" },
      fixtureScope(),
      trace,
    );

    expect(output).toMatchObject({ ok: false, code: "entity_out_of_scope" });
    expect(ports.focusTrain).not.toHaveBeenCalled();
    expect(trace.snapshot().events.at(-1)).toMatchObject({
      type: "viewer_action",
      status: "rejected",
    });
  });

  it("applies a bounded display time as a reversible action", () => {
    const ports = fixturePorts();
    const executor = new ViewerActionExecutor(ports, 2_880);
    const scope = fixtureScope();
    const trace = new AgentTraceRecorder("execution-1");

    const output = executor.execute(
      { type: "set_display_time", routeTimeMinutes: 1_440 },
      scope,
      trace,
    );

    expect(output).toMatchObject({ ok: true, effect: "reversible" });
    expect(ports.setDisplayTime).toHaveBeenCalledWith(1_440);
  });

  it("sanitizes a port failure and records its rejection", () => {
    const ports = fixturePorts();
    ports.focusTrain = vi.fn(() => {
      throw new Error("private viewer state");
    });
    const trace = new AgentTraceRecorder("execution-1");

    const output = new ViewerActionExecutor(ports, 2_880).execute(
      { type: "focus_train", serviceUid: "service-1" },
      fixtureScope(),
      trace,
    );

    expect(output).toMatchObject({ ok: false, code: "execution_failed" });
    expect(JSON.stringify(trace.snapshot())).not.toContain("private viewer state");
  });
});

function fixtureScope(): ViewerActionTaskScope {
  const scope = new ViewerActionTaskScope("execution-1");
  scope.registerJourney("journey-1", ["service-1"]);
  scope.registerJourney("journey-2", ["service-2"]);
  scope.registerEvidence("evidence-1");
  return scope;
}

function fixturePorts() {
  return {
    setDisplayTime: vi.fn(),
    focusTrain: vi.fn(() => true),
    highlightRoute: vi.fn(() => true),
    compareJourneys: vi.fn(() => true),
    showEvidence: vi.fn(() => true),
    setWeather: vi.fn(),
    setLayerVisibility: vi.fn(),
  };
}
