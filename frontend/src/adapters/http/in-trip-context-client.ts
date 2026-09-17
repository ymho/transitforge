import { validateInTripContext } from "@raiquora/trip/in-trip-context";
import type { InTripContextReader } from "../../usecases/agent/in-trip-context";

export class HttpInTripContextClient implements InTripContextReader {
  constructor(private readonly request: typeof fetch = fetch) {}
  async read(tripId: string) {
    const response = await this.request("/api/trips/in-trip/v1", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "in-trip-api-v1", tripId }) });
    if (!response.ok) throw new Error("旅行中の最新情報を確認できません");
    const v = await response.json();
    if (!v || v.version !== "in-trip-api-v1" || Object.keys(v).some((k) => !["version", "snapshot"].includes(k))) throw new Error("Invalid context response");
    if (v.snapshot === null) return undefined;
    validateInTripContext(v.snapshot); return v.snapshot;
  }
}
