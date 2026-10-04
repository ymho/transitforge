import { pathToFileURL } from "node:url";

export function verifyLoginLifetime(value) {
  if (value?.access !== 5 || value?.id !== 5 || value?.refresh !== 12 ||
      value?.units?.AccessToken !== "minutes" || value?.units?.IdToken !== "minutes" || value?.units?.RefreshToken !== "hours")
    throw new Error("Unexpected login lifetime");
  return "Login lifetime verified: access=5 minutes; id=5 minutes; refresh=12 hours.\n";
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 8192) throw new Error("Oversized projection");
    }
    process.stdout.write(verifyLoginLifetime(JSON.parse(input)));
  } catch {
    process.stderr.write("Login lifetime verification failed.\n"); process.exitCode = 1;
  }
}
