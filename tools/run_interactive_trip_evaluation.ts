import { appendFile, readFile, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createInteractiveTripSession, parseInteractiveTripCommand } from "./agent-transport/interactive-trip-session.js";
import { createEvaluationAuthentication } from "./agent-transport/evaluation-authentication.js";
import { loginForEvaluation } from "./agent-transport/evaluation-login.js";
import { createEvaluationStateReader } from "./agent-transport/evaluation-state-reader.js";

// JSON lines on stdin are chosen by the evaluator after reading each stdout result.
// Normal PKCE login for a dedicated test account; never read browser storage.
const origin = process.env.KAIHO_EVAL_ORIGIN;
const configPath = process.env.KAIHO_EVAL_AUTH_CONFIG;
const report = process.env.KAIHO_EVAL_REPORT;
if (!origin || !configPath || !report) {
  console.error("KAIHO_EVAL_ORIGIN, KAIHO_EVAL_AUTH_CONFIG and KAIHO_EVAL_REPORT are required.");
  process.exitCode = 2;
} else {
  const reportFile = resolve(report);
  // A new private artifact only; never append to an existing file or follow a symlink.
  const output = await open(reportFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  await output.close();
  const setup = JSON.parse(await readFile(resolve(configPath), "utf8")) as { authConfig: unknown; subject: string; stateTable: string; tripTable: string };
  if (!setup || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(setup.subject) ||
      !setup.stateTable || !setup.tripTable) throw new Error("invalid_evaluation_setup");
  const auth = createEvaluationAuthentication({ config: setup.authConfig, callback: "http://127.0.0.1:8788/index.html", expectedSubject: setup.subject });
  const stop = new AbortController();
  const reader = createEvaluationStateReader({ issuer: (setup.authConfig as { issuer: string }).issuer,
    subject: setup.subject, stateTable: setup.stateTable, tripTable: setup.tripTable }, undefined, stop.signal);
  let input: ReturnType<typeof createInterface> | undefined;
  const cancel = () => { stop.abort(); input?.close(); };
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    await loginForEvaluation(auth, url => process.stderr.write(`Open this login URL in the browser on this process's machine:\n${url}\n`), stop.signal);
    const controller = createInteractiveTripSession({ origin, token: () => auth.token(), signal: stop.signal,
      readInternal: async target => { await auth.token(); return reader(target); } });
    input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let sequence = 0;
    for await (const line of input) {
      if (!line.trim()) continue;
      const startedAt = new Date().toISOString();
      let command: unknown, observation: unknown;
      try {
        if (Buffer.byteLength(line) > 40000) throw new Error("invalid_command");
        command = parseInteractiveTripCommand(JSON.parse(line));
        observation = await controller.execute(command);
      } catch (error) {
        const known = new Set(["invalid_command", "command_in_progress", "unknown_session", "no_session", "turn_budget_exhausted",
          "no_previous_turn", "no_adoption_preview", "trip_unavailable", "stale_edit_target", "no_previous_edit", "unknown_item",
          "action_budget_exhausted", "session_budget_exhausted"]);
        observation = { error: error instanceof Error && known.has(error.message) ? error.message : "command_failed", executionConfirmed: false };
      }
      const entry = { sequence: ++sequence, startedAt, command, observation, transport: command ? controller.transportObservations() : [] };
      // Raw public observations are private test artifacts, not Git or production logs.
      await appendFile(reportFile, JSON.stringify(entry) + "\n", { flag: constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW });
      console.log(JSON.stringify(entry));
    }
  } catch { console.error("Interactive evaluation could not complete; authentication or execution is unavailable."); process.exitCode = 1; }
  finally {
    input?.close(); process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
    try { await auth.close(); } catch { console.error("Evaluation token revocation is unconfirmed."); process.exitCode = 1; }
  }
}
