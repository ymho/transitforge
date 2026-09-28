import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { GroundRouteProvider, GroundRouteRequest } from "../ports/ground-route-provider.js";
import type { OtpGraphManifestRepository } from "../ports/otp-graph-manifest-repository.js";
import { parseGroundRouteBridgeRequest, parseGroundRouteBridgeResult } from "./ground-route-bridge-contract.js";

export interface GroundRouteLambdaInvoker {
  invoke(input: { FunctionName: string; InvocationType: "RequestResponse"; LogType: "None"; Payload: Uint8Array }, signal: AbortSignal): Promise<{ StatusCode?: number; FunctionError?: string; Payload?: Uint8Array }>;
}
export function awsGroundRouteLambdaInvoker(): GroundRouteLambdaInvoker {
  const client = new LambdaClient({ maxAttempts: 1 });
  return { invoke: (input, abortSignal) => client.send(new InvokeCommand(input), { abortSignal }) };
}

/** Non-VPC Agent adapter. The pinned manifest supplies bounded failure metadata. */
export class LambdaGroundRouteProvider implements GroundRouteProvider {
  constructor(private readonly functionArn: string, private readonly manifests: OtpGraphManifestRepository,
    private readonly invoker: GroundRouteLambdaInvoker = awsGroundRouteLambdaInvoker()) {}
  async search(request: GroundRouteRequest, signal?: AbortSignal) {
    const manifest = await this.manifests.load();
    const parsed = parseGroundRouteBridgeRequest(request);
    const timeout = AbortSignal.timeout(10_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.invoker.invoke({ FunctionName: this.functionArn, InvocationType: "RequestResponse", LogType: "None",
        Payload: new TextEncoder().encode(JSON.stringify(parsed)) }, combined);
      if (response.StatusCode !== 200 || response.FunctionError || !response.Payload || response.Payload.byteLength > 1_500_000)
        throw new Error("OTP bridge unavailable");
      const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.Payload));
      return parseGroundRouteBridgeResult(decoded, manifest.coverage, parsed.mode);
    } catch {
      return { status: "unavailable" as const, reason: "経路検索サービスに接続できません", coverage: manifest.coverage };
    }
  }
}
