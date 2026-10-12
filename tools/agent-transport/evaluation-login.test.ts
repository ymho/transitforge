import { expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { request } from "node:http";
import { loginForEvaluation } from "./evaluation-login.js";
import type { EvaluationAuthentication } from "./evaluation-authentication.js";

function fixture() {
  const complete = vi.fn(async () => {});
  const auth: EvaluationAuthentication = { begin: async () => "https://login.example.test/authorize", complete,
    token: async () => { throw new Error("not used"); }, close: async () => {} };
  return { auth, complete };
}
async function portIsReleased() {
  const server = createServer();
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(8788, "127.0.0.1", yes); });
  await new Promise<void>(yes => server.close(() => yes()));
}

it("serves only its single callback and closes the listener after login without echoing the code", async () => {
  const f = fixture();
  let announced: () => void = () => {};
  const ready = new Promise<void>(resolve => { announced = resolve; });
  const login = loginForEvaluation(f.auth, () => announced());
  await ready;
  const wrong = await fetch("http://127.0.0.1:8788/debug"); expect(wrong.status).toBe(404); await wrong.text();
  const callback = "http://127.0.0.1:8788/index.html?code=private-fixture-code&state=fixture";
  const result = await fetch(callback);
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.text()).not.toContain("private-fixture-code");
  await login;
  expect(f.complete).toHaveBeenCalledExactlyOnceWith(callback);
  await portIsReleased();
});

it("rejects another Host and releases the callback listener when cancelled", async () => {
  const f = fixture(), stop = new AbortController();
  let announced: () => void = () => {};
  const ready = new Promise<void>(resolve => { announced = resolve; });
  const login = loginForEvaluation(f.auth, () => announced(), stop.signal);
  const outcome = login.then(() => "completed", error => error.message as string);
  await ready;
  const status = await new Promise<number | undefined>((yes, no) => {
    const req = request({ host: "127.0.0.1", port: 8788, path: "/index.html?code=fixture&state=fixture", headers: { Host: "wrong.example.test" } }, res => {
      res.resume(); res.once("end", () => yes(res.statusCode));
    }); req.once("error", no); req.end();
  });
  expect(status).toBe(404); expect(f.complete).not.toHaveBeenCalled();
  stop.abort(); expect(await outcome).toBe("evaluation_login_cancelled");
  await portIsReleased();
});
