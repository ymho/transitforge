import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import type { TrainIndex } from "../../domain/rail/train";
import { createReadonlyTransitToolRegistry } from "../../domain/agent/readonly-transit-tool-registry";
import { NetworkInspectionService } from "../../domain/network-inspection-service";
import { AgentToolRegistry } from "../../domain/agent/tool-registry";
import { createReadonlyTransitMcpServer } from "./readonly-transit-mcp";

const trainIndex: TrainIndex = {
  schema_version: "train-index-v1",
  path_catalog: "path_catalog.json",
  service_date: "2026-08-25",
  trains: [{
    service_uid: "service-a",
    train_no: "1001M",
    service_type: "新快速",
    train_name: "",
    origin_station: "京都",
    destination_station: "大阪",
    path_id: "path-a",
    stops: [
      { station_name: "京都", event: "発", route_time_minutes: 480 },
      { station_name: "大阪", event: "着", route_time_minutes: 510 },
    ],
  }],
};

function readonlyRegistry(): AgentToolRegistry {
  return createReadonlyTransitToolRegistry({
    journeySearch: {
      search: async () => {
        throw new Error("このテストでは実行しません");
      },
    },
    networkInspection: new NetworkInspectionService(trainIndex),
    operationalAnalysis: {
      loadDelayAnalysis: async () => {
        throw new Error("このテストでは実行しません");
      },
      loadCongestionAnalysis: async () => {
        throw new Error("このテストでは実行しません");
      },
      loadTrains: async () => trainIndex.trains,
      lineNameForTrain: () => "京都線",
    },
  });
}

async function connectedClient(registry = readonlyRegistry()) {
  const server = createReadonlyTransitMcpServer(registry);
  const client = new Client({ name: "raiquora-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

describe("read-only transit MCP adapter", () => {
  it("exposes only the five allowlisted Domain Tools", async () => {
    const { client, server } = await connectedClient();
    try {
      const { tools } = await client.listTools();

      expect(tools.map(({ name }) => name)).toEqual([
        "search_journeys",
        "inspect_train",
        "inspect_station",
        "analyze_delay",
        "analyze_congestion",
      ]);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
      expect(tools.map(({ name }) => name)).not.toContain("focus_train");
      expect(tools.map(({ name }) => name)).not.toContain("get_route_details");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("executes the same registry-backed station inspection through MCP", async () => {
    const registry = readonlyRegistry();
    const direct = await registry.execute(
      "inspect_station",
      { stationName: "京都" },
      { executionId: "direct-test" },
    );
    const { client, server } = await connectedClient(registry);
    try {
      const result = await client.callTool({
        name: "inspect_station",
        arguments: { stationName: "京都" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const content = result.content[0];
      expect(content.type).toBe("text");
      if (content.type === "text" && direct.ok) {
        expect(JSON.parse(content.text)).toEqual(direct.output);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects malformed inputs at the MCP schema boundary", async () => {
    const { client, server } = await connectedClient();
    try {
      await expect(client.callTool({
        name: "inspect_station",
        arguments: { stationName: "京都", viewerAction: "focus_train" },
      })).resolves.toMatchObject({ isError: true });
      await expect(client.callTool({
        name: "search_journeys",
        arguments: {
          serviceDate: "2026-08-25",
          originStation: "京都",
          destinationStation: "大阪",
          departureTimeMinutes: 480,
          limit: 4,
        },
      })).resolves.toMatchObject({ isError: true });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("fails closed when an allowlisted Domain Tool is missing", () => {
    expect(() => createReadonlyTransitMcpServer(new AgentToolRegistry()))
      .toThrowError("読み取り専用Tool「search_journeys」がRegistryにありません");
  });
});
