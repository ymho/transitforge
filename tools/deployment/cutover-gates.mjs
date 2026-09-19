import { pathToFileURL } from "node:url";

const gateNames = ["TF_VAR_enable_fixed_egress_provider"];
const safeReplacementAttribute = /^[a-z][a-z0-9_]{0,63}$/u;
const unsafeReplacementAttribute = /secret|token|password|private|public|account|arn|policy|environment|output|variable|value/u;

function hasResourceName(resource, fragment) {
  return typeof resource.name === "string" && resource.name.includes(fragment);
}

function isFixedEgressNetwork(resource) {
  return typeof resource.name === "string" && /^(?:ai_egress|ai_nat)(?:_|$)/u.test(resource.name);
}

function replacementPaths(change, actions) {
  if (!(actions.includes("create") && actions.includes("delete"))) return "";
  if (!Array.isArray(change.replace_paths) || change.replace_paths.length === 0) return null;
  const paths = [];
  for (const path of change.replace_paths) {
    if (!Array.isArray(path) || path.length !== 1) return null;
    const [attribute] = path;
    if (typeof attribute !== "string" || !safeReplacementAttribute.test(attribute) || unsafeReplacementAttribute.test(attribute)) return null;
    paths.push(attribute);
  }
  return [...new Set(paths)].join(", ");
}

export function deploymentSafetyInputs(environment) {
  const values = gateNames.map(name => {
    if (!["true", "false"].includes(environment[name])) throw new Error(`${name} must be explicitly true or false`);
    return environment[name] === "true";
  });
  const [provider] = values;
  return { provider };
}

/** No values from plan/state/policies/outputs are printed, including on malformed input. */
export function reviewCutoverPlan(plan, environment) {
  const gates = deploymentSafetyInputs(environment);
  if (!plan || !/^1\./u.test(plan.format_version ?? "") || !Array.isArray(plan.resource_changes) || plan.errored || plan.complete === false) {
    throw new Error("A complete Terraform JSON plan is required");
  }
  for (const [name, value] of [["enable_fixed_egress_provider", gates.provider]]) {
    // Terraform records raw CLI/TF_VAR inputs as strings, but tfvars/defaults as booleans.
    const planned = plan.variables?.[name]?.value;
    if (planned !== value && planned !== String(value)) throw new Error("Plan gate inputs differ from validated deployment inputs");
  }
  const summary = ["Terraform plan: resource actions only; sensitive values omitted."];
  const destructive = [];
  let unsafeProtectedReplacement = false;
  for (const resource of plan.resource_changes) {
    if (resource.mode !== "managed") continue;
    const { actions, before } = resource.change ?? {};
    if (!Array.isArray(actions) || !actions.length || actions.some(a => !["no-op", "create", "read", "update", "delete"].includes(a))) {
      throw new Error("Invalid Terraform resource actions");
    }
    const stream = hasResourceName(resource, "agent_stream");
    const provider = hasResourceName(resource, "fixed_egress");
    const fixedEgressNetwork = isFixedEgressNetwork(resource);
    const protectedResource = stream || provider || fixedEgressNetwork;
    const destroysProtectedResource = protectedResource && actions.includes("delete");
    if (typeof resource.address !== "string" || !/^[a-zA-Z0-9_.\[\]"-]+$/u.test(resource.address)) {
      if (destroysProtectedResource) {
        unsafeProtectedReplacement = true;
        continue;
      }
      throw new Error("Invalid Terraform resource address");
    }
    const isSafeAgentStreamDeploymentRotation =
      resource.type === "aws_api_gateway_deployment" &&
      resource.name === "agent_stream" &&
      resource.address === 'aws_api_gateway_deployment.agent_stream["stream"]' &&
      actions.length === 2 && actions[0] === "create" && actions[1] === "delete";
    if (destroysProtectedResource && !isSafeAgentStreamDeploymentRotation) {
      const paths = replacementPaths(resource.change, actions);
      if (paths === null) unsafeProtectedReplacement = true;
      else destructive.push({ address: resource.address, actions: actions.join("/"), paths });
    }
    if (before != null && provider && !gates.provider) {
      throw new Error("Existing fixed-egress infrastructure cannot be disabled by CD");
    }
    if (actions.every(a => a === "no-op")) continue;
    summary.push(`${actions.join("/")} ${resource.address}`);
  }
  if (unsafeProtectedReplacement) throw new Error("protected replacement detected");
  if (destructive.length) {
    const diagnostics = destructive.map(({ address, actions, paths }) => `- ${address} (${actions}${paths ? `; replace_paths: ${paths}` : ""})`);
    throw new Error(`Cutover destructive plan detected:\n\n${diagnostics.join("\n")}`);
  }
  return summary.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "inputs") deploymentSafetyInputs(process.env);
    else if (process.argv[2] === "plan") {
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      let plan;
      try { plan = JSON.parse(input); } catch { throw new Error("Invalid Terraform JSON plan"); }
      process.stdout.write(reviewCutoverPlan(plan, process.env));
    } else throw new Error("Expected inputs or plan mode");
  } catch (error) {
    // Only our fixed validation messages: never print parser errors or plan contents.
    process.stderr.write(`Cutover guard rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}
