import { describe, expect, it } from "vitest";

import type { StationLineCatalog } from "../rail/station";
import type { TrainIndex } from "../rail/train";
import {
  maximumRouteDetailStops,
  NetworkInspectionService,
} from "../network-inspection-service";
import {
  createGetRouteDetailsTool,
  createInspectStationTool,
  createInspectTrainTool,
  maximumInspectionToolPayloadBytes,
} from "./network-inspection-tools";
import { AgentToolRegistry } from "./tool-registry";

const stationCatalog: StationLineCatalog = {
  schema_version: "station-line-catalog-v1",
  source: "test",
  lines: [
    {
      operator: "事業者A",
      line: "京都線",
      stations: [
        { name: "京都", coordinate: [135.758, 34.986] },
        { name: "大阪", coordinate: [135.498, 34.702] },
        { name: "新大阪", coordinate: [135.5, 34.733] },
      ],
    },
    {
      operator: "事業者A",
      line: "奈良線",
      stations: [{ name: "京都駅", coordinate: [135.759, 34.985] }],
    },
    {
      operator: "事業者A",
      line: "環状線",
      stations: [{ name: "大正", coordinate: [135.48, 34.665] }],
    },
  ],
};

const trainIndex = (trainName = "新快速"): TrainIndex => ({
  schema_version: "train-index-v1",
  path_catalog: "path_catalog.json",
  service_date: "2026-08-25",
  station_line_catalog: stationCatalog,
  trains: [{
    service_uid: "service-a",
    train_no: "1001M",
    service_type: "新快速",
    train_name: trainName,
    origin_station: "京都",
    destination_station: "駅24",
    path_id: "path-a",
    stops: Array.from({ length: 25 }, (_, index) => ({
      station_name: index === 0 ? "京都" : index === 10 ? "大阪" : `駅${index}`,
      event: index === 24 ? "着" : "発",
      route_time_minutes: 480 + index * 5,
    })),
  }],
});

function registryFor(service: NetworkInspectionService): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  registry.register(createInspectTrainTool(service));
  registry.register(createInspectStationTool(service));
  registry.register(createGetRouteDetailsTool(service));
  return registry;
}

describe("network inspection tools", () => {
  const context = { executionId: "execution-1" };

  it("inspects a train without returning its full timetable", async () => {
    const registry = registryFor(new NetworkInspectionService(trainIndex()));

    const result = await registry.execute(
      "inspect_train",
      { serviceUid: "service-a" },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        serviceUid: "service-a",
        trainNumber: "1001M",
        originStation: "京都",
        destinationStation: "駅24",
        timetableStopCount: 25,
        firstTimeMinutes: 480,
        lastTimeMinutes: 600,
        source: "timetable",
      },
    });
    expect(JSON.stringify(result)).not.toContain('"stops"');
  });

  it("returns an explicit error for an unknown serviceUid", async () => {
    const registry = registryFor(new NetworkInspectionService(trainIndex()));

    await expect(registry.execute(
      "inspect_train",
      { serviceUid: "missing" },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "not_found", retryable: false },
    });
  });

  it("uses exact normalized station names and rejects ambiguous or unknown names", async () => {
    const registry = registryFor(new NetworkInspectionService(trainIndex()));

    const known = await registry.execute(
      "inspect_station",
      { stationName: "京都駅" },
      context,
    );
    expect(known).toMatchObject({
      ok: true,
      output: {
        normalizedStationName: "京都",
        lines: [{ lineName: "京都線" }, { lineName: "奈良線" }],
        timetableServiceCount: 1,
        source: "station-line-catalog",
      },
    });
    await expect(registry.execute(
      "inspect_station",
      { stationName: "大" },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "ambiguous_entity" },
    });
    await expect(registry.execute(
      "inspect_station",
      { stationName: "架空" },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(registry.execute(
      "inspect_station",
      { stationName: "新大" },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("paginates route stops and can limit the route to a verified segment", async () => {
    const registry = registryFor(new NetworkInspectionService(trainIndex()));

    const page = await registry.execute(
      "get_route_details",
      { serviceUid: "service-a", offset: 0, limit: 3 },
      context,
    );
    expect(page).toMatchObject({
      ok: true,
      output: {
        totalStopRecordCount: 25,
        returnedStopRecordCount: 3,
        hasMore: true,
        stops: [
          { stationName: "京都", routeTimeMinutes: 480 },
          { stationName: "駅1", routeTimeMinutes: 485 },
          { stationName: "駅2", routeTimeMinutes: 490 },
        ],
      },
    });
    const segment = await registry.execute(
      "get_route_details",
      {
        serviceUid: "service-a",
        originStation: "駅2",
        destinationStation: "駅5",
      },
      context,
    );
    expect(segment).toMatchObject({
      ok: true,
      output: {
        segmentOriginStation: "駅2",
        segmentDestinationStation: "駅5",
        totalStopRecordCount: 4,
        hasMore: false,
      },
    });
    await expect(registry.execute(
      "get_route_details",
      {
        serviceUid: "service-a",
        originStation: "駅5",
        destinationStation: "駅2",
      },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("rejects requests and payloads beyond the documented bounds", async () => {
    const registry = registryFor(new NetworkInspectionService(trainIndex()));
    await expect(registry.execute(
      "get_route_details",
      { serviceUid: "service-a", limit: maximumRouteDetailStops + 1 },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });

    const oversizedRegistry = registryFor(new NetworkInspectionService(
      trainIndex("長".repeat(maximumInspectionToolPayloadBytes)),
    ));
    await expect(oversizedRegistry.execute(
      "inspect_train",
      { serviceUid: "service-a" },
      context,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "execution_failed", retryable: false },
    });
  });
});
