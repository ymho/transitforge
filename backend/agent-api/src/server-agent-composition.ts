import { randomUUID } from "node:crypto";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { weatherToolDescriptor } from "@raiquora/agent/weather-tool-descriptor";
import type { WeatherForecastProvider } from "./ports/weather-provider.js";
import { createWeatherForecastOperation } from "./usecases/weather-forecast.js";
import { createServerAgentApplication, type ServerAgentDependencies } from "./usecases/agent/server-agent.js";
import { registerServerTools, type ServerAgentToolBinding } from "./usecases/agent/server-tools.js";
import type { AgentDiagnosticsSink } from "./ports/agent-diagnostics.js";

/** Server composition: Application owns tools/state; the required engine owns the model loop. */
export function createServerAgent(options: {
  weather: WeatherForecastProvider;
  additionalTools?: readonly ServerAgentToolBinding[];
  limits?: ServerAgentDependencies["limits"];
  newExecutionId?: () => string;
  loadContext?: ServerAgentDependencies["loadContext"];
  registerAdditionalTools?: ServerAgentDependencies["registerTools"];
  diagnostics?: AgentDiagnosticsSink;
  log?: ServerAgentDependencies["log"];
  detailedResearchAllowed?: boolean;
  detailedResearchLimits?: Partial<import("@raiquora/agent/runtime-policies").AgentRuntimeLimits>;
  onResearchLedger?: ServerAgentDependencies["onResearchLedger"];
  projectResult?: ServerAgentDependencies["projectResult"];
  /** Trusted composition-only execution engine. Never sourced from request payloads. */
  runRuntime: ServerAgentDependencies["runRuntime"];
}) {
  return createServerAgentApplication({
    newExecutionId: options.newExecutionId ?? randomUUID,
    limits: options.limits,
    loadContext: options.loadContext,
    diagnostics: options.diagnostics,
    log: options.log,
    detailedResearchAllowed: options.detailedResearchAllowed,
    detailedResearchLimits: options.detailedResearchLimits,
    onResearchLedger: options.onResearchLedger,
    projectResult: options.projectResult,
    runRuntime: options.runRuntime,
    registerTools: (tools, evidence, scope) => { registerServerTools(tools, evidence, [
      { descriptor: weatherToolDescriptor, operation: createWeatherForecastOperation(options.weather), evidence: externalTravelEvidence },
      ...(options.additionalTools ?? []),
    ]); options.registerAdditionalTools?.(tools, evidence, scope); },
  });
}
