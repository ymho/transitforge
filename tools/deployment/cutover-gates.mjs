import { pathToFileURL } from "node:url";

const gateNames = ["TF_VAR_agent_stream_enabled", "TF_VAR_enable_fixed_egress_provider", "VITE_SERVER_AGENT_ENABLED"];

export function cutoverGates(environment) {
  const values = gateNames.map(name => {
    if (!["true", "false"].includes(environment[name])) throw new Error(`${name} must be explicitly true or false`);
    return environment[name] === "true";
  });
  const [stream, provider, browser] = values;
  if (browser && !stream) throw new Error("Browser requires streaming infrastructure");
  if (stream && !provider) throw new Error("Server Agent requires fixed-egress Provider infrastructure");
  return { stream, provider, browser };
}

/** No values from plan/state/policies/outputs are printed, including on malformed input. */
export function reviewCutoverPlan(plan, environment) {
  const gates = cutoverGates(environment);
  if (!plan || !/^1\./u.test(plan.format_version ?? "") || !Array.isArray(plan.resource_changes) || plan.errored || plan.complete === false) {
    throw new Error("A complete Terraform JSON plan is required");
  }
  for (const [name, value] of [["agent_stream_enabled", gates.stream], ["enable_fixed_egress_provider", gates.provider]]) {
    // Terraform records raw CLI/TF_VAR inputs as strings, but tfvars/defaults as booleans.
    const planned = plan.variables?.[name]?.value;
    if (planned !== value && planned !== String(value)) throw new Error("Plan gate inputs differ from validated deployment inputs");
  }
  const summary = ["Terraform plan: resource actions only; sensitive values omitted."];
  for (const resource of plan.resource_changes) {
    if (resource.mode !== "managed") continue;
    const { actions, before } = resource.change ?? {};
    if (!Array.isArray(actions) || !actions.length || actions.some(a => !["no-op", "create", "read", "update", "delete"].includes(a))) {
      throw new Error("Invalid Terraform resource actions");
    }
    const stream = resource.name?.includes("agent_stream");
    const provider = resource.name?.includes("fixed_egress");
    if ((stream || provider) && actions.includes("delete")) throw new Error("Cutover infrastructure deletion/replacement is prohibited in CD");
    if (before != null && ((stream && !gates.stream) || (provider && !gates.provider))) {
      throw new Error("Existing cutover infrastructure cannot be disabled by CD");
    }
    if (actions.every(a => a === "no-op")) continue;
    if (typeof resource.address !== "string" || !/^[a-zA-Z0-9_.\[\]"-]+$/u.test(resource.address)) throw new Error("Invalid Terraform resource address");
    summary.push(`${actions.join("/")} ${resource.address}`);
  }
  return summary.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "inputs") cutoverGates(process.env);
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
