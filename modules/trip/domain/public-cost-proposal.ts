import type { TripUpdateProposal } from "./trip";
import { validateCostForecast } from "./trip-costs";
import { exactKeys } from "./snapshot-validation";
export type PublicCostProposal = TripUpdateProposal & { readonly patches: readonly [Extract<TripUpdateProposal["patches"][number], { type: "cost_forecast" }>]; };
export function parsePublicCostProposal(value: unknown): PublicCostProposal {
  const raw = JSON.stringify(value);
  if (!raw || new TextEncoder().encode(raw).length > 12_288) throw new Error("Cost proposal exceeds limit");
  const p = JSON.parse(raw) as PublicCostProposal;
  exactKeys(p, ["tripId", "baseRevision", "summary", "patches"]);
  if (typeof p.summary !== "string" || !p.summary.trim() || p.summary.length > 500 || !Array.isArray(p.patches) || p.patches.length !== 1 || p.patches[0]?.type !== "cost_forecast") throw new Error("Invalid cost proposal");
  exactKeys(p.patches[0], ["type", "forecast"]);
  const forecast = p.patches[0].forecast; validateCostForecast(forecast);
  if (p.tripId !== forecast.tripId || p.baseRevision !== forecast.baseRevision) throw new Error("Wrong cost proposal basis");
  return p;
}
