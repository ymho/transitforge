import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { AccommodationProvider } from "../ports/travel-provider.js";
import type { TravelProviderSearch } from "@raiquora/trip/travel-provider";
import { parseProviderRequest, parseProviderResponse, providerResponseBytes, ProviderBoundaryError } from "./fixed-egress-provider-contract.js";

export interface ProviderLambdaInvoker {
  invoke(input: { FunctionName: string; InvocationType: "RequestResponse"; LogType: "None"; Payload: Uint8Array }, signal: AbortSignal): Promise<{ StatusCode?: number; FunctionError?: string; Payload?: Uint8Array }>;
}
/** SDK retry is disabled: the Agent's bounded Tool policy owns retries. */
export function awsProviderLambdaInvoker(): ProviderLambdaInvoker {
  const client = new LambdaClient({ maxAttempts: 1 });
  return { invoke: (input, abortSignal) => client.send(new InvokeCommand(input), { abortSignal }) };
}
export class LambdaAccommodationProvider implements AccommodationProvider {
  constructor(private readonly functionArn: string, private readonly invoker: ProviderLambdaInvoker = awsProviderLambdaInvoker()) {}
  async search(request: TravelProviderSearch, requestId?: string) {
    const event = parseProviderRequest({ operation: "search_accommodation", request, ...(requestId ? { requestId } : {}) });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.invoker.invoke({ FunctionName: this.functionArn, InvocationType: "RequestResponse", LogType: "None", Payload: new TextEncoder().encode(JSON.stringify(event)) }, controller.signal);
      if (response.StatusCode !== 200 || response.FunctionError || !response.Payload) throw new ProviderBoundaryError("unavailable");
      if (response.Payload.byteLength > providerResponseBytes) throw new ProviderBoundaryError("oversized_result");
      let decoded: unknown;
      try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.Payload)); }
      catch { throw new ProviderBoundaryError("malformed_response"); }
      const result = parseProviderResponse(decoded, request);
      if (!result.ok) throw new ProviderBoundaryError(result.error.code);
      return result.accommodations;
    } catch (error) {
      if (error instanceof ProviderBoundaryError) throw error;
      throw new ProviderBoundaryError(controller.signal.aborted ? "provider_timeout" : "unavailable");
    } finally { clearTimeout(timeout); }
  }
}
