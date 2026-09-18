import { afterEach, expect, it, vi } from "vitest";
import { LambdaAccommodationProvider, type ProviderLambdaInvoker } from "./lambda-accommodation-provider.js";
import { createFixedEgressProviderHandler } from "./fixed-egress-provider-handler.js";
import { createFixedEgressAccommodationOperation } from "../composition/fixed-egress-accommodation.js";
import { providerErrorRetryable } from "../ports/provider-boundary-error.js";

const request = { destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02", adults: 1, limit: 3 };
const offering = { kind: "accommodation", provider: "travel-provider", providerItemId: "42", name: "宿", checkInDate: request.checkInDate, checkOutDate: request.checkOutDate, availability: "unknown" } as const;
const payload = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
afterEach(() => vi.useRealTimers());
it("runs the existing Usecase through fake IAM Invoke and the typed handler", async () => {
  const search = vi.fn().mockResolvedValue([offering]);
  const handler = createFixedEgressProviderHandler({ search });
  const invoke = vi.fn<ProviderLambdaInvoker["invoke"]>().mockImplementation(async input => ({ StatusCode: 200, Payload: payload(await handler(JSON.parse(new TextDecoder().decode(input.Payload)))) }));
  const operation = createFixedEgressAccommodationOperation("provider-arn", { invoke });
  expect(await operation(request, { requestId: "execution-1" })).toEqual({ body: { accommodations: [offering] } });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]![0]).toMatchObject({ FunctionName: "provider-arn", InvocationType: "RequestResponse", LogType: "None" });
  expect(JSON.parse(new TextDecoder().decode(invoke.mock.calls[0]![0].Payload))).toEqual({ operation: "search_accommodation", request, requestId: "execution-1" });
  expect(search).toHaveBeenCalledWith(request, "execution-1");
});
it.each(Object.entries(providerErrorRetryable))("preserves %s retryability through operation status", async (code, retryable) => {
  const invoke = vi.fn().mockResolvedValue({ StatusCode: 200, Payload: payload({ ok: false, error: { code, retryable } }) });
  expect(await createFixedEgressAccommodationOperation("provider-arn", { invoke })(request, { requestId: "exec" })).toEqual({ statusCode: retryable ? 503 : 422, body: { error: { code, retryable } } });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it.each([
  { StatusCode: 200, FunctionError: "Unhandled", Payload: payload({ secret: "secret" }) },
  { StatusCode: 202 }, { StatusCode: 200 },
  { StatusCode: 200, Payload: payload({ ok: true, accommodations: [{ ...offering, secret: "secret" }] }) },
  { StatusCode: 200, Payload: payload({ ok: true, accommodations: [{ ...offering, bookingUrl: "javascript:alert(1)" }] }) },
  { StatusCode: 200, Payload: payload({ ok: false, error: { code: "unavailable", retryable: false } }) },
  { StatusCode: 200, Payload: payload({ ok: false, error: { code: "secret", retryable: true } }) },
  { StatusCode: 200, Payload: new Uint8Array(32769) },
  { StatusCode: 200, Payload: payload("secret") },
])("rejects function failure, malformed and oversized responses without leaking detail", async response => {
  const invoke = vi.fn().mockResolvedValue(response);
  await expect(new LambdaAccommodationProvider("arn", { invoke }).search(request)).rejects.toThrow("宿泊提供者の検索を利用できません。");
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("normalizes SDK exceptions without cause or details", async () => {
  const provider = new LambdaAccommodationProvider("arn", { invoke: async () => { throw new Error("secret credentials"); } });
  const error = await provider.search(request).catch(error => error);
  expect(error.code).toBe("unavailable");
  expect(error.cause).toBeUndefined();
  expect(String(error)).not.toContain("secret");
});
it("aborts the caller at 30 seconds without SDK retry", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn<ProviderLambdaInvoker["invoke"]>().mockImplementation(async (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const pending = expect(new LambdaAccommodationProvider("arn", { invoke }).search(request)).rejects.toMatchObject({ code: "provider_timeout" });
  await vi.advanceTimersByTimeAsync(30000);
  await pending;
  expect(invoke).toHaveBeenCalledTimes(1);
});
