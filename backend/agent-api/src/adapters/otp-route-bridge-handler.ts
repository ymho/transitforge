import type { GroundRouteProvider } from "../ports/ground-route-provider.js";
import type { OtpGraphManifestRepository } from "../ports/otp-graph-manifest-repository.js";
import { parseGroundRouteBridgeRequest } from "./ground-route-bridge-contract.js";

/** IAM-only Lambda boundary. Exceptions and request details never cross or enter logs. */
export function createOtpRouteBridgeHandler(manifests: OtpGraphManifestRepository,
  provider: (coverage: Awaited<ReturnType<OtpGraphManifestRepository["load"]>>["coverage"]) => GroundRouteProvider) {
  return async (event: unknown) => {
    const request = parseGroundRouteBridgeRequest(event);
    const manifest = await manifests.load();
    return provider(manifest.coverage).search(request);
  };
}
