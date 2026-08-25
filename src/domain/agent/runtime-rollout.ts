import type { AgentRuntimeFeature } from "./runtime-contract";

export interface FeatureScopedRequest {
  feature: AgentRuntimeFeature;
}

export type FeatureScopedHandler<Request extends FeatureScopedRequest, Result> = (
  request: Request,
) => Promise<Result>;

export class AgentRuntimeRolloutRouter<
  Request extends FeatureScopedRequest,
  Result,
> {
  private readonly enabledFeatures: ReadonlySet<AgentRuntimeFeature>;

  constructor(
    enabledFeatures: Iterable<AgentRuntimeFeature>,
    private readonly agentHandler: FeatureScopedHandler<Request, Result>,
    private readonly legacyHandler: FeatureScopedHandler<Request, Result>,
  ) {
    this.enabledFeatures = new Set(enabledFeatures);
  }

  handle(request: Request): Promise<Result> {
    return this.enabledFeatures.has(request.feature)
      ? this.agentHandler(request)
      : this.legacyHandler(request);
  }
}
