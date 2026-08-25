import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/server";

import {
  readonlyTransitToolNames,
  type ReadonlyTransitToolName,
} from "../../domain/agent/readonly-transit-tool-registry";
import type { AgentToolRegistry } from "../../domain/agent/tool-registry";
import { agentToolInputSchemaToZod } from "./agent-tool-schema";

const readonlyToolNameSet = new Set<string>(readonlyTransitToolNames);

export interface ReadonlyTransitMcpServerOptions {
  name?: string;
  version?: string;
}

export function createReadonlyTransitMcpServer(
  registry: AgentToolRegistry,
  options: ReadonlyTransitMcpServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: options.name ?? "raiquora-readonly-transit",
    version: options.version ?? "0.1.0",
  });
  const descriptors = new Map(
    registry.descriptors().map((descriptor) => [descriptor.name, descriptor]),
  );

  for (const name of readonlyTransitToolNames) {
    const descriptor = descriptors.get(name);
    if (!descriptor) {
      throw new Error(`読み取り専用Tool「${name}」がRegistryにありません`);
    }
    server.registerTool(
      name,
      {
        description: descriptor.description,
        inputSchema: agentToolInputSchemaToZod(descriptor.inputSchema),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        const result = await registry.execute(name, input, {
          executionId: `mcp-${randomUUID()}`,
        });
        return result.ok
          ? {
              content: [{ type: "text" as const, text: JSON.stringify(result.output) }],
            }
          : {
              isError: true,
              content: [{ type: "text" as const, text: JSON.stringify(result.error) }],
            };
      },
    );
  }
  return server;
}

export function isReadonlyTransitToolName(
  name: string,
): name is ReadonlyTransitToolName {
  return readonlyToolNameSet.has(name);
}
