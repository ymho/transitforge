import type { ViewerAgentAction } from "../viewer/viewer-action";

export type ToolViewerActionMapper = (output: unknown) => ViewerAgentAction[];

export class ToolViewerActionRegistry {
  private readonly mappers = new Map<string, ToolViewerActionMapper>();

  register(toolName: string, mapper: ToolViewerActionMapper): void {
    if (this.mappers.has(toolName)) {
      throw new Error(`Tool「${toolName}」のViewer Action mapperは登録済みです`);
    }
    this.mappers.set(toolName, mapper);
  }

  collect(toolName: string, output: unknown): ViewerAgentAction[] {
    return this.mappers.get(toolName)?.(output) ?? [];
  }
}
