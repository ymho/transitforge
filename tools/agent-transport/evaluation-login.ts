import { createServer } from "node:http";
import type { EvaluationAuthentication } from "./evaluation-authentication.js";

/** This callback listener exists only while one user grant is in progress.
 * Bound to loopback, with no access log, debug route or reusable credential file. */
export async function loginForEvaluation(auth: EvaluationAuthentication, announce: (url: string) => void, signal?: AbortSignal) {
  let settle: () => void, reject: (error: Error) => void;
  const completed = new Promise<void>((yes, no) => { settle = yes; reject = no; });
  void completed.catch(() => undefined);
  let consumed = false;
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store"); res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    if (req.method !== "GET" || req.headers.host !== "127.0.0.1:8788" || !req.url?.startsWith("/index.html?") || consumed) {
      res.writeHead(404); res.end("Not found"); return;
    }
    consumed = true;
    try {
      await auth.complete(`http://127.0.0.1:8788${req.url}`);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); res.end("試験用の認証が完了しました。このページを閉じてください。", () => settle());
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }); res.end("試験用の認証を完了できませんでした。", () => reject(new Error("evaluation_login_failed")));
    }
  });
  const timeout = setTimeout(() => reject(new Error("evaluation_login_expired")), 600_000);
  const abort = () => reject(new Error("evaluation_login_cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("evaluation_login_cancelled");
    await new Promise<void>((yes, no) => { server.once("error", no); server.listen(8788, "127.0.0.1", yes); });
    announce(await auth.begin());
    await completed;
  } finally {
    clearTimeout(timeout); server.closeAllConnections();
    signal?.removeEventListener("abort", abort);
    await new Promise<void>(yes => server.close(() => yes()));
  }
}
