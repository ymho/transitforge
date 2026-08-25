import type { Evidence } from "./evidence-model";

export interface ToolEvidenceContext {
  executionId: string;
  retrievedAt: string;
}

export type ToolEvidenceMapper = (
  output: unknown,
  context: ToolEvidenceContext,
) => Evidence[];

export class ToolEvidenceRegistry {
  private readonly mappers = new Map<string, ToolEvidenceMapper>();

  register(toolName: string, mapper: ToolEvidenceMapper): void {
    if (this.mappers.has(toolName)) {
      throw new Error(`Tool「${toolName}」のEvidence mapperは登録済みです`);
    }
    this.mappers.set(toolName, mapper);
  }

  collect(
    toolName: string,
    output: unknown,
    context: ToolEvidenceContext,
  ): Evidence[] {
    return this.mappers.get(toolName)?.(output, context) ?? [];
  }
}
