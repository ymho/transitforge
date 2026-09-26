import { pathToFileURL } from "node:url";

function flag(value) {
  if (value !== "true" && value !== "false") throw new Error("Explicit boolean configuration required");
  return value;
}

/** Accept only the small AWS CLI projection, never log Environment or provider errors. */
export function verifyAgentRuntime(snapshot, environment) {
  const expectedV2 = flag(environment.TF_VAR_agent_runtime_v2_enabled);
  const expectedSemantic = flag(environment.TF_VAR_conversation_semantic_kernel_enabled);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      snapshot.state !== "Active" || snapshot.updateStatus !== "Successful" ||
      snapshot.v2 !== expectedV2 || snapshot.semantic !== expectedSemantic) {
    throw new Error("Deployed Agent runtime does not match the requested active configuration");
  }
  return `Agent runtime verified: v2=${expectedV2}; semantic=${expectedSemantic}; state=Active; update=Successful.\n`;
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
    process.stderr.write("Agent runtime verification failed; inspect the deployment state and selected flags.\n");
    process.exitCode = 1;
  }
}
