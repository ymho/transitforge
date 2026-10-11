import { parentPort, workerData } from "node:worker_threads";
import { searchJourneyIndex } from "@raiquora/journey";
import { createHash } from "node:crypto";
import { verifiedJourneySelectionItems } from "@raiquora/trip/verified-journey-search-selection";
const result = searchJourneyIndex(workerData.request, workerData.input);
let items: ReturnType<typeof verifiedJourneySelectionItems> = [];
try { items = verifiedJourneySelectionItems(result, workerData.input.index, workerData.retrievedAt, createHash("sha256").update(JSON.stringify(workerData.input.index)).digest("hex")); }
catch { /* Incomplete provenance stays read-only. */ }
parentPort!.postMessage({ result, items });
