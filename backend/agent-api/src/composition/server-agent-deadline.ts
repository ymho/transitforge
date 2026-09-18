/** Business execution budget, independent of the Lambda/Gateway transport timeouts.
 * Terraform supplies 120s; at most 180s leaves 60s before the 240s Lambda timeout.
 * Keep the shared Browser/local Runtime defaults unchanged.
 */
export function serverAgentDeadline(environment: Readonly<Record<string, string | undefined>>): number {
  const value = environment.SERVER_AGENT_MAX_EXECUTION_MS;
  if (!value || !/^[1-9][0-9]*$/u.test(value)) throw new Error("Invalid Server Agent deadline configuration");
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000 || milliseconds > 180_000) {
    throw new Error("Invalid Server Agent deadline configuration");
  }
  return milliseconds;
}
