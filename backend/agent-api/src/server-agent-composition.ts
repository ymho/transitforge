import { structuredModelClassPolicy } from "@raiquora/agent/structured-model-class-policy";
import { randomUUID } from "node:crypto";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { weatherToolDescriptor } from "@raiquora/agent/weather-tool-descriptor";
import { ConversationModelProvider } from "./adapters/conversation-model-provider.js";
import type { ConversationModel } from "./ports/conversation-model.js";
import type { WeatherForecastProvider } from "./ports/weather-provider.js";
import { createWeatherForecastOperation } from "./usecases/weather-forecast.js";
import { createServerAgentApplication, type ServerAgentDependencies } from "./usecases/agent/server-agent.js";
import { registerServerTools, type ServerAgentToolBinding } from "./usecases/agent/server-tools.js";

/** Internal composition only. Public routes remain on the Browser runtime until #480. */
export function createServerAgent(options: {
  model: ConversationModel;
  weather: WeatherForecastProvider;
  additionalTools?: readonly ServerAgentToolBinding[];
  limits?: ServerAgentDependencies["limits"];
  newExecutionId?: () => string;
}) {
  return createServerAgentApplication({
    newExecutionId: options.newExecutionId ?? randomUUID,
    createModel: scope => new ConversationModelProvider(options.model, scope.executionId),
    modelClassPolicy: structuredModelClassPolicy,
    limits: options.limits,
    registerTools: (tools, evidence) => registerServerTools(tools, evidence, [
      { descriptor: weatherToolDescriptor, operation: createWeatherForecastOperation(options.weather), evidence: externalTravelEvidence },
      ...(options.additionalTools ?? []),
    ]),
  });
}
