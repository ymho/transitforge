import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import type { AgentToolRegistry } from "../../application/agent/tool-registry";
import { createReadonlyTransitMcpServer } from "./readonly-transit-mcp";

/**
 * Registryの具体的なデータ取得方法はComposition Rootから注入する。
 * stdoutはMCPプロトコル専用のため、この関数はログを出力しない。
 */
export function serveReadonlyTransitMcp(
  registry: AgentToolRegistry,
): StdioServerHandle {
  return serveStdio(() => createReadonlyTransitMcpServer(registry));
}
