import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createTrip, type ItineraryItem, type Trip } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { measureTripWorkload } from "@raiquora/trip/trip-workload";
import { buildTemporalConstraintNetwork, checkTemporalConsistency } from "@raiquora/trip/temporal-constraint-network";
import { boundedTrip, tripApiLimits } from "../backend/agent-api/src/contracts/trip-api.js";
import { createAgentContextSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";

const repetitions = integerArgument("--repetitions", 30, 3, 500);
const outputDirectory = resolve(argument("--output-dir") ?? "/tmp/transitforge-epic-537-scale");
const generatedAt = new Date().toISOString();
const fixtures = [fixture(1), fixture(7), fixture(30), fixture(90)];
const cases = fixtures.map((trip) => measure(trip, repetitions));
const itemBoundary = itemBoundaryCheck();
const payloadBoundary = payloadBoundaryCheck();
const thirty = cases.find(({ days }) => days === 30)!, ninety = cases.find(({ days }) => days === 90)!;
const safelyComplete = (value: typeof thirty) => value.failureRate === 0 && value.projection.coverageComplete && value.publicPresentation.coverageComplete;
const retainAggregate = safelyComplete(thirty) && safelyComplete(ninety) && payloadBoundary.nextRejected && itemBoundary.rejection === "payload-too-large";
const report = { version: "epic-537-scale-report-v1", generatedAt,
  environment: { node: process.version, platform: process.platform, arch: process.arch, repetitions,
    note: "Latency and heap are local comparative observations, not production SLOs." },
  limits: tripApiLimits, cases, itemBoundary, payloadBoundary,
  conclusions: {
    thirtyDay: safelyComplete(thirty) ? "complete" : "failed",
    ninetyDay: safelyComplete(ninety) ? "complete" : ninety.projection.omittedCount > 0 ? "safe-partial" : "failed",
    storageDecision: retainAggregate ? "retain-single-aggregate" : "reassess-chunking",
    chunkMigrationRequired: !retainAggregate,
    rationale: retainAggregate ? "Measured fixtures remain within the existing 100-item/256KiB aggregate and every measured production-shaped phase completed without failure. Immutable chunk migration is not justified by this offline measurement." :
      "At least one measured boundary or production-shaped phase failed; storage chunking must be reassessed before rollout.",
  } } as const;

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "epic-537-scale-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "epic-537-scale-report.md"), markdown(report), "utf8"),
]);
console.log(`Epic #537 Scale: 30d p95=${thirty.totalMs.p95.toFixed(3)}ms, 90d p95=${ninety.totalMs.p95.toFixed(3)}ms (${outputDirectory})`);

function fixture(days: number): Trip {
  const logicalDays = Array.from({ length: days }, (_, index) => ({ id: `day-${index + 1}`, label: `${index + 1}日目` }));
  const items: ItineraryItem[] = logicalDays.map((day, index) => ({ id: `activity-${index + 1}`, title: `観光 ${index + 1}`,
    type: "activity", category: "sightseeing", logicalDayId: day.id,
    schedule: { type: "relative", dayId: day.id, part: index % 2 ? "afternoon" : "morning" } }));
  return createTrip("11111111-1111-4111-8111-111111111111", `${days}日 stress`, "2026-09-23T00:00:00Z", items,
    { constraints: [], assumptions: [] }, "itinerary_draft", undefined, { version: 1, logicalDays, calendarBindings: [] });
}

function measure(trip: Trip, count: number) {
  const durations: number[] = [], heaps: number[] = [], phaseValues = Object.fromEntries(["projection", "workload", "constraintNetwork", "globalFeasibility", "context", "storageRoundTrip", "publicPresentation"].map((phase) => [phase, [] as number[]])) as Record<string, number[]>;
  let failures = 0;
  let lastProjection = projectDailyItinerary(trip, { limit: 90 });
  let lastNetwork = buildTemporalConstraintNetwork(trip);
  let lastPresentation = publicPresentation(trip);
  let contextBytes = 0;
  for (let index = 0; index < count; index++) {
    const heapBefore = process.memoryUsage().heapUsed, started = performance.now();
    try {
      const projection = timed("projection", () => projectDailyItinerary(trip, { limit: 90 }));
      timed("workload", () => measureTripWorkload(trip, projection));
      const network = timed("constraintNetwork", () => buildTemporalConstraintNetwork(trip));
      timed("globalFeasibility", () => checkTemporalConsistency(network));
      const context = timed("context", () => createAgentContextSnapshot(undefined, trip)); contextBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
      timed("storageRoundTrip", () => boundedTrip(JSON.parse(JSON.stringify(trip))));
      const presentation = timed("publicPresentation", () => publicPresentation(trip));
      durations.push(performance.now() - started);
      heaps.push(Math.max(0, process.memoryUsage().heapUsed - heapBefore));
      lastProjection = projection; lastNetwork = network; lastPresentation = presentation;
    } catch { failures += 1; }
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(trip), "utf8");
  return { days: trip.timeline!.logicalDays.length, items: trip.items.length, payloadBytes,
    projectedReceiptAmplificationBytes: payloadBytes * 2,
    totalMs: percentiles(durations), phasesMs: Object.fromEntries(Object.entries(phaseValues).map(([phase, values]) => [phase, percentiles(values)])),
    positiveHeapDeltaBytes: percentiles(heaps), failureCount: failures, failureRate: failures / count,
    projection: { dayCount: lastProjection.days.length, unscheduledCount: lastProjection.unscheduled.length,
      coverageComplete: lastProjection.coverage.complete, omittedCount: lastProjection.coverage.omittedCount },
    temporal: { variableCount: lastNetwork.variables.length, edgeCount: lastNetwork.edges.length,
      missingFactCount: lastNetwork.missingFactRefs.length }, context: { payloadBytes: contextBytes },
    storageRoundTrip: { status: "complete" }, publicPresentation: { payloadBytes: Buffer.byteLength(JSON.stringify(lastPresentation), "utf8"),
      candidateCount: lastPresentation.candidates.length, dayCount: lastPresentation.candidates[0]!.days.length,
      coverageComplete: lastPresentation.coverage.status === "complete" } };

  function timed<T>(phase: string, run: () => T): T { const began = performance.now(); try { return run(); } finally { phaseValues[phase]!.push(performance.now() - began); } }
}

function publicPresentation(trip: Trip) {
  const items = trip.items.map((item) => ({ itemRef: item.id, sourceRef: item.id, title: item.title, kind: "activity" as const,
    timing: item.schedule.type === "relative" ? "day" as const : "unscheduled" as const, evidenceRefs: [], photoRefs: [] }));
  const days = trip.timeline!.logicalDays.map((day) => ({ dayRef: day.id, label: day.label ?? day.id, status: "planned" as const,
    entries: trip.items.filter((item) => item.logicalDayId === day.id).map((item) => ({ entryRef: `${day.id}:${item.id}`, itemRef: item.id, role: "visit" as const })) }));
  return parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: `scale:${trip.timeline!.logicalDays.length}`,
    candidateSetRef: { kind: "unavailable", reason: "not-retained" }, candidateOrder: ["variant:scale"], candidates: [{ variantId: "variant:scale", label: "Scale",
      dayOrder: days.map(({ dayRef }) => dayRef), days, items, unknowns: [], comparisonAssessmentRefs: [], scenarioRefs: [] }], evidenceRefs: [], photoRefs: [],
    coverage: { status: "complete", coveredDayRefs: days.map(({ dayRef }) => dayRef), omittedDayRefs: [], omittedScopes: [] }, statements: [],
    comparisonAssessmentRefs: [], scenarioRefs: [], researchOutcome: { status: "complete", requestedMode: "standard", effectiveMode: "standard",
      budget: { modelCalls: 0, toolCalls: 0, wallClockMs: 0 }, coveredScopes: ["scale"], remainingScopes: [] } });
}

function itemBoundaryCheck() {
  const hundred = fixtureWithItems(100), oneHundredOne = fixtureWithItems(101);
  boundedTrip(hundred);
  let rejected = false;
  try { boundedTrip(oneHundredOne); } catch (error) { rejected = (error as { code?: string }).code === "payload-too-large"; }
  if (!rejected) throw new Error("101-item fixture was not rejected");
  return { acceptedItems: hundred.items.length, rejectedItems: oneHundredOne.items.length, rejection: "payload-too-large" };
}

function payloadBoundaryCheck() {
  let low = 1, high = tripApiLimits.stringLength;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2), bytes = Buffer.byteLength(JSON.stringify(fixtureWithItems(100, middle)), "utf8");
    if (bytes <= tripApiLimits.bodyBytes) low = middle; else high = middle - 1;
  }
  const accepted = fixtureWithItems(100, low), acceptedBytes = Buffer.byteLength(JSON.stringify(accepted), "utf8");
  boundedTrip(accepted);
  let nextBytes: number | undefined, rejected = false;
  if (low < tripApiLimits.stringLength) {
    const next = fixtureWithItems(100, low + 1); nextBytes = Buffer.byteLength(JSON.stringify(next), "utf8");
    try { boundedTrip(next); } catch (error) { rejected = (error as { code?: string }).code === "payload-too-large"; }
  }
  if (nextBytes !== undefined && nextBytes > tripApiLimits.bodyBytes && !rejected) throw new Error("Over-limit UTF-8 fixture was not rejected");
  return { titleCharactersPerItem: low, acceptedBytes, nextBytes, nextRejected: rejected,
    singleMutationTripAndReceiptBytes: acceptedBytes * 2, projectedHundredImmutableReceiptBytes: acceptedBytes * 100,
    utf8: "Japanese three-byte code points" };
}

function fixtureWithItems(items: number, titleCharacters = 2): Trip {
  const title = "旅".repeat(titleCharacters);
  return createTrip("22222222-2222-4222-8222-222222222222", "境界", "2026-09-23T00:00:00Z",
    Array.from({ length: items }, (_, index): ItineraryItem => ({ id: `item-${index + 1}`, title, type: "activity", category: "other", schedule: { type: "unscheduled" } })));
}

function percentiles(values: number[]) {
  if (!values.length) return { min: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (rate: number) => sorted[Math.max(0, Math.ceil(sorted.length * rate) - 1)]!;
  return { min: sorted[0]!, p50: at(.5), p95: at(.95), max: sorted.at(-1)! };
}
function markdown(value: typeof report): string {
  const rows = value.cases.map((item) => `| ${item.days} | ${item.items} | ${item.payloadBytes} | ${item.totalMs.p50.toFixed(3)} | ${item.totalMs.p95.toFixed(3)} | ${Math.round(item.positiveHeapDeltaBytes.p95)} | ${item.failureRate.toFixed(3)} | ${item.projection.coverageComplete ? "complete" : `partial (${item.projection.omittedCount})`} |`).join("\n");
  return `# Epic #537 scale measurement\n\nGenerated: ${value.generatedAt}\n\nNode ${value.environment.node}, ${value.environment.platform}/${value.environment.arch}, ${value.environment.repetitions} repetitions. Latency and heap values are local comparative observations, not production SLOs.\n\n| days | items | payload bytes | p50 ms | p95 ms | p95 positive heap delta | failure rate | coverage |\n|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\nEach JSON case also records phase p50/p95 for projection, workload, temporal feasibility, Context snapshot, persistence parser round-trip, and PublicPlanPresentation projection.\n\n- 100 items: accepted; 101 items: rejected with \`${value.itemBoundary.rejection}\`.\n- UTF-8 accepted boundary fixture: ${value.payloadBoundary.acceptedBytes} bytes; next: ${value.payloadBoundary.nextBytes ?? "n/a"} bytes (${value.payloadBoundary.nextRejected ? "rejected" : "within limit"}).\n- One near-limit Trip plus one immutable receipt: ${value.payloadBoundary.singleMutationTripAndReceiptBytes} bytes across separate items. Projected 100 immutable receipts: ${value.payloadBoundary.projectedHundredImmutableReceiptBytes} bytes.\n- Storage decision: ${value.conclusions.storageDecision}; chunk migration required: ${value.conclusions.chunkMigrationRequired}.\n`;
}
function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function integerArgument(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = argument(name); if (raw === undefined) return fallback; const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`); return value;
}
