import { pathToFileURL } from "node:url";

/** Accept only the small AWS CLI projection, never log Environment or provider errors. */
export function verifyAgentRuntime(snapshot, environment) {
  const expectedModelId = environment.TF_VAR_bedrock_model_id;
  if (typeof expectedModelId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(expectedModelId))
    throw new Error("Explicit model configuration required");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      snapshot.state !== "Active" || snapshot.updateStatus !== "Successful" ||
      snapshot.runtime !== "strands-v2" || snapshot.legacyV2 !== null || snapshot.legacySemantic !== null || snapshot.modelId !== expectedModelId) {
    throw new Error("Deployed Agent runtime does not match the requested active configuration");
  }
  return `Agent runtime verified: runtime=strands-v2; legacy-flags=removed; state=Active; update=Successful; model=${expectedModelId}.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input, "utf8") > 8192) throw new Error("Oversized configuration projection");
    }
    process.stdout.write(verifyAgentRuntime(JSON.parse(input), process.env));
  } catch {
    // Fixed message only: parser/provider/config values must never enter CI logs.
    process.stderr.write("Agent runtime verification failed; inspect the deployment state and runtime configuration.\n");
    process.exitCode = 1;
  }
}
