import type { GroundRouteCoverage } from "./ground-route-provider.js";

export interface OtpGraphManifest {
  version: string;
  graph: { bucket: string; key: string; bytes: number; sha256: string };
  otpImage: string;
  coverage: GroundRouteCoverage;
}

export interface OtpGraphManifestRepository {
  load(): Promise<OtpGraphManifest>;
}
