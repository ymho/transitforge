export const epic537FinalInputVersion = "epic-537-final-input-v1";
export const epic537FinalExpectedVersion = "epic-537-final-expected-v1";
export const epic537FinalObservationVersion = "epic-537-final-observation-v1";
export const epic537FinalManifestVersion = "epic-537-final-manifest-v1";

export const epic537EvaluationLayers = [
  "A_pure_domain",
  "B_production_composition_synthetic",
  "C_live_model_synthetic_provider",
  "D_live_provider_browser_server",
] as const;
export type Epic537EvaluationLayer = typeof epic537EvaluationLayers[number];

export const epic537MetricNames = [
  "candidateRecall", "candidateDiversity", "rerankQuality", "itineraryCoverage",
  "constraintCompliance", "semanticGrounding", "unnecessaryQuestionAvoidance",
  "referenceAccuracy", "costCorrectness", "workloadCorrectness",
  "partialChangeMinimality", "robustness", "saveReloadConsistency",
] as const;
export type Epic537MetricName = typeof epic537MetricNames[number];

export interface Epic537FinalInputSet {
  schemaVersion: typeof epic537FinalInputVersion;
  cases: Array<{
    id: string;
    layer: Epic537EvaluationLayer;
    category: string;
    heldOut: boolean;
    seed: number;
    fixedNow: string;
    userRequest: string;
    providerFixtureRefs: string[];
    scenarioRefs: string[];
  }>;
}

export interface Epic537FinalExpectedSet {
  schemaVersion: typeof epic537FinalExpectedVersion;
  cases: Array<{
    caseId: string;
    requiredInvariantIds: string[];
    minimumMetrics: Partial<Record<Epic537MetricName, number>>;
    maximumMetrics: Partial<Record<Epic537MetricName, number>>;
  }>;
}

export type Epic537MeasurementStatus = "measured" | "not_measured" | "failed" | "not_applicable";
export interface Epic537FinalObservationSet {
  schemaVersion: typeof epic537FinalObservationVersion;
  observations: Array<{
    caseId: string;
    layer: Epic537EvaluationLayer;
    status: Epic537MeasurementStatus;
    repetitions: number;
    invariants: Array<{ id: string; passed: boolean; detail?: string }>;
    metrics: Partial<Record<Epic537MetricName, number | null>>;
    runtime: {
      modelCalls: number | null;
      toolCalls: number | null;
      latencyMs: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
      estimatedCostUsd: number | null;
      failures: number;
    };
    reason?: string;
  }>;
}

export interface Epic537FinalManifest {
  schemaVersion: typeof epic537FinalManifestVersion;
  runId: string;
  createdAt: string;
  sourceRevision: string;
  datasetRevision: string;
  seeds: number[];
  fixedClock: string;
  structureVersions: { before: string; after: string };
  models: { current: string; upper: string };
  modelRegion: string;
  inferenceSettings: Record<string, string | number | boolean>;
  providerFixtureVersion: string;
  sourceVersions: Record<string, string>;
  cacheState: "off" | "cold" | "warm" | "ttl_expired" | "mixed";
  pricingVersion: string;
  promptVersion: string;
  schemaVersionRef: string;
  toolVersion: string;
  comparison: Array<{
    structure: "before" | "after";
    model: "current" | "upper";
    status: Epic537MeasurementStatus;
    repetitions: number;
    metrics: Partial<Record<Epic537MetricName, number | null>>;
    latencyP95Ms: number | null;
    estimatedCostUsd: number | null;
    reason?: string;
  }>;
  confounders: string[];
  smallSampleNotice: string;
}

export interface Epic537FinalReport {
  schemaVersion: "epic-537-final-report-v1";
  runId: string;
  layers: Record<Epic537EvaluationLayer, { measured: number; failed: number; notMeasured: number; notApplicable: number }>;
  cases: Array<{ caseId: string; layer: Epic537EvaluationLayer; status: Epic537MeasurementStatus; passed: boolean | null; failures: string[] }>;
  comparison: Epic537FinalManifest["comparison"];
  allComparisonCellsMeasured: boolean;
  caveats: string[];
}

export function parseEpic537FinalInputs(value: unknown): Epic537FinalInputSet {
  const root = record(value, "input root");
  exact(root, ["schemaVersion", "cases"], "input root");
  if (root.schemaVersion !== epic537FinalInputVersion || !Array.isArray(root.cases) || !root.cases.length) throw new Error("Invalid final Eval inputs");
  const cases = root.cases.map((raw, index) => {
    const item = record(raw, `input ${index}`);
    exact(item, ["id", "layer", "category", "heldOut", "seed", "fixedNow", "userRequest", "providerFixtureRefs", "scenarioRefs"], `input ${index}`);
    if (!identifier(item.id) || !epic537EvaluationLayers.includes(item.layer as Epic537EvaluationLayer) || !text(item.category, 120) ||
      typeof item.heldOut !== "boolean" || !Number.isSafeInteger(item.seed) || !instant(item.fixedNow) || !text(item.userRequest, 10_000) ||
      !stringList(item.providerFixtureRefs, 30) || !stringList(item.scenarioRefs, 30)) throw new Error(`Invalid final Eval input ${index}`);
    return structuredClone(item) as unknown as Epic537FinalInputSet["cases"][number];
  });
  unique(cases.map(({ id }) => id), "input case");
  return { schemaVersion: epic537FinalInputVersion, cases };
}

export function parseEpic537FinalExpected(value: unknown): Epic537FinalExpectedSet {
  const root = record(value, "expected root"); exact(root, ["schemaVersion", "cases"], "expected root");
  if (root.schemaVersion !== epic537FinalExpectedVersion || !Array.isArray(root.cases) || !root.cases.length) throw new Error("Invalid final Eval expected");
  const cases = root.cases.map((raw, index) => {
    const item = record(raw, `expected ${index}`); exact(item, ["caseId", "requiredInvariantIds", "minimumMetrics", "maximumMetrics"], `expected ${index}`);
    if (!identifier(item.caseId) || !stringList(item.requiredInvariantIds, 100)) throw new Error(`Invalid final Eval expected ${index}`);
    const minimumMetrics = metricRecord(item.minimumMetrics, false) as Partial<Record<Epic537MetricName, number>>;
    const maximumMetrics = metricRecord(item.maximumMetrics, false) as Partial<Record<Epic537MetricName, number>>;
    return { caseId: item.caseId, requiredInvariantIds: [...item.requiredInvariantIds], minimumMetrics, maximumMetrics };
  });
  unique(cases.map(({ caseId }) => caseId), "expected case");
  return { schemaVersion: epic537FinalExpectedVersion, cases };
}

export function parseEpic537FinalObservations(value: unknown): Epic537FinalObservationSet {
  const root = record(value, "observation root"); exact(root, ["schemaVersion", "observations"], "observation root");
  if (root.schemaVersion !== epic537FinalObservationVersion || !Array.isArray(root.observations)) throw new Error("Invalid final Eval observations");
  const observations = root.observations.map((raw, index) => {
    const item = record(raw, `observation ${index}`);
    exact(item, ["caseId", "layer", "status", "repetitions", "invariants", "metrics", "runtime", "reason"], `observation ${index}`);
    if (!identifier(item.caseId) || !epic537EvaluationLayers.includes(item.layer as Epic537EvaluationLayer) || !measurementStatus(item.status) ||
      !Number.isSafeInteger(item.repetitions) || Number(item.repetitions) < 0 || !Array.isArray(item.invariants)) throw new Error(`Invalid final Eval observation ${index}`);
    const invariants = item.invariants.map((rawInvariant) => {
      const invariant = record(rawInvariant, "invariant"); exact(invariant, ["id", "passed", "detail"], "invariant");
      if (!identifier(invariant.id) || typeof invariant.passed !== "boolean" || invariant.detail !== undefined && !text(invariant.detail, 500)) throw new Error("Invalid invariant");
      return structuredClone(invariant) as { id: string; passed: boolean; detail?: string };
    });
    const metrics = metricRecord(item.metrics, true), runtime = runtimeRecord(item.runtime);
    if (item.status === "measured" && String(item.layer).startsWith("C_") && Number(item.repetitions) < 3 ||
      item.status === "measured" && String(item.layer).startsWith("D_") && Number(item.repetitions) < 3) throw new Error("Live measurement needs at least three repetitions");
    if (item.status !== "measured" && Object.values(metrics).some((metric) => metric !== null)) throw new Error("Unmeasured metrics must be null, never zero");
    if (item.status !== "measured" && !text(item.reason, 500)) throw new Error("Unmeasured observation needs a reason");
    return { caseId: item.caseId as string, layer: item.layer as Epic537EvaluationLayer, status: item.status as Epic537MeasurementStatus,
      repetitions: item.repetitions as number, invariants, metrics, runtime, ...(item.reason === undefined ? {} : { reason: item.reason as string }) };
  });
  unique(observations.map(({ caseId }) => caseId), "observation case");
  return { schemaVersion: epic537FinalObservationVersion, observations };
}

export function parseEpic537FinalManifest(value: unknown): Epic537FinalManifest {
  const root = record(value, "manifest");
  exact(root, ["schemaVersion", "runId", "createdAt", "sourceRevision", "datasetRevision", "seeds", "fixedClock", "structureVersions", "models", "modelRegion", "inferenceSettings", "providerFixtureVersion", "sourceVersions", "cacheState", "pricingVersion", "promptVersion", "schemaVersionRef", "toolVersion", "comparison", "confounders", "smallSampleNotice"], "manifest");
  if (root.schemaVersion !== epic537FinalManifestVersion || !identifier(root.runId) || !instant(root.createdAt) || !identifier(root.sourceRevision) ||
    !identifier(root.datasetRevision) || !Array.isArray(root.seeds) || !root.seeds.length || root.seeds.some(seed => !Number.isSafeInteger(seed)) ||
    !instant(root.fixedClock) || !text(root.modelRegion, 100) || !identifier(root.providerFixtureVersion) || !identifier(root.pricingVersion) ||
    !identifier(root.promptVersion) || !identifier(root.schemaVersionRef) || !identifier(root.toolVersion) || !stringList(root.confounders, 50) || !text(root.smallSampleNotice, 1_000)) throw new Error("Invalid final Eval manifest");
  const structureVersions = pair(root.structureVersions, "before", "after"), models = pair(root.models, "current", "upper");
  const inferenceSettings = scalarRecord(root.inferenceSettings), sourceVersions = stringRecord(root.sourceVersions);
  if (!["off", "cold", "warm", "ttl_expired", "mixed"].includes(String(root.cacheState)) || !Array.isArray(root.comparison) || root.comparison.length !== 4) throw new Error("Invalid final Eval comparison");
  const comparison = root.comparison.map(parseComparisonCell);
  const cells = comparison.map(({ structure, model }) => `${structure}:${model}`); unique(cells, "comparison cell");
  if (!["before:current", "before:upper", "after:current", "after:upper"].every(cell => cells.includes(cell))) throw new Error("Final Eval comparison must contain the full 2x2 matrix");
  return structuredClone({ ...root, structureVersions, models, inferenceSettings, sourceVersions, comparison }) as Epic537FinalManifest;
}

export function runEpic537FinalEvaluation(inputs: Epic537FinalInputSet, expected: Epic537FinalExpectedSet,
  observations: Epic537FinalObservationSet, manifest: Epic537FinalManifest): Epic537FinalReport {
  const expectations = new Map(expected.cases.map(item => [item.caseId, item]));
  const measured = new Map(observations.observations.map(item => [item.caseId, item]));
  if (expected.cases.some(item => !inputs.cases.some(input => input.id === item.caseId)) || observations.observations.some(item => !inputs.cases.some(input => input.id === item.caseId))) throw new Error("Expected/observation refers to unknown input case");
  const layers = Object.fromEntries(epic537EvaluationLayers.map(layer => [layer, { measured: 0, failed: 0, notMeasured: 0, notApplicable: 0 }])) as Epic537FinalReport["layers"];
  const cases = inputs.cases.map(input => {
    const expectation = expectations.get(input.id), observation = measured.get(input.id);
    if (!expectation || !observation || observation.layer !== input.layer) throw new Error(`Missing or mismatched final Eval record: ${input.id}`);
    const bucket = layers[input.layer];
    if (observation.status === "measured") bucket.measured++; else if (observation.status === "failed") bucket.failed++;
    else if (observation.status === "not_measured") bucket.notMeasured++; else bucket.notApplicable++;
    if (observation.status !== "measured") return { caseId: input.id, layer: input.layer, status: observation.status,
      passed: observation.status === "failed" ? false : null, failures: [observation.reason ?? observation.status] };
    const invariantMap = new Map(observation.invariants.map(invariant => [invariant.id, invariant]));
    const failures = expectation.requiredInvariantIds.filter(id => invariantMap.get(id)?.passed !== true).map(id => `invariant:${id}`);
    for (const [name, threshold] of Object.entries(expectation.minimumMetrics)) {
      const value = observation.metrics[name as Epic537MetricName]; if (value === undefined || value === null || value < threshold) failures.push(`minimum:${name}`);
    }
    for (const [name, threshold] of Object.entries(expectation.maximumMetrics)) {
      const value = observation.metrics[name as Epic537MetricName]; if (value === undefined || value === null || value > threshold) failures.push(`maximum:${name}`);
    }
    return { caseId: input.id, layer: input.layer, status: observation.status, passed: failures.length === 0, failures };
  });
  return { schemaVersion: "epic-537-final-report-v1", runId: manifest.runId, layers, cases, comparison: structuredClone(manifest.comparison),
    allComparisonCellsMeasured: manifest.comparison.every(cell => cell.status === "measured"),
    caveats: [manifest.smallSampleNotice, ...manifest.confounders, "A/Bの成功はC/Dの実測を代替しない。not_measuredは0点や成功へ変換しない。"] };
}

function parseComparisonCell(value: unknown): Epic537FinalManifest["comparison"][number] {
  const item = record(value, "comparison cell"); exact(item, ["structure", "model", "status", "repetitions", "metrics", "latencyP95Ms", "estimatedCostUsd", "reason"], "comparison cell");
  if (!(["before", "after"] as unknown[]).includes(item.structure) || !(["current", "upper"] as unknown[]).includes(item.model) || !measurementStatus(item.status) ||
    !Number.isSafeInteger(item.repetitions) || Number(item.repetitions) < 0 || !nullableNonNegative(item.latencyP95Ms) || !nullableNonNegative(item.estimatedCostUsd)) throw new Error("Invalid comparison cell");
  const metrics = metricRecord(item.metrics, true);
  if (item.status === "measured" && Number(item.repetitions) < 3) throw new Error("Comparison cells need at least three repetitions");
  if (item.status !== "measured" && (Object.values(metrics).some(metric => metric !== null) || item.latencyP95Ms !== null || item.estimatedCostUsd !== null)) throw new Error("Unmeasured comparison must use null, never zero");
  if (item.status !== "measured" && !text(item.reason, 500)) throw new Error("Unmeasured comparison needs a reason");
  return structuredClone(item) as Epic537FinalManifest["comparison"][number];
}

function runtimeRecord(value: unknown): Epic537FinalObservationSet["observations"][number]["runtime"] {
  const item = record(value, "runtime");
  exact(item, ["modelCalls", "toolCalls", "latencyMs", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "estimatedCostUsd", "failures"], "runtime");
  for (const key of ["modelCalls", "toolCalls", "latencyMs", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "estimatedCostUsd"] as const) if (!nullableNonNegative(item[key])) throw new Error(`Invalid runtime ${key}`);
  if (!Number.isSafeInteger(item.failures) || Number(item.failures) < 0) throw new Error("Invalid runtime failures");
  return structuredClone(item) as Epic537FinalObservationSet["observations"][number]["runtime"];
}
function metricRecord(value: unknown, nullable: boolean): Partial<Record<Epic537MetricName, number | null>> {
  const item = record(value, "metrics");
  if (Object.keys(item).some(key => !epic537MetricNames.includes(key as Epic537MetricName)) || Object.values(item).some(metric =>
    metric === null ? !nullable : typeof metric !== "number" || !Number.isFinite(metric) || metric < 0 || metric > 1)) throw new Error("Invalid final Eval metrics");
  return structuredClone(item) as Partial<Record<Epic537MetricName, number | null>>;
}
function pair(value: unknown, left: string, right: string): Record<string, string> { const item = record(value, "pair"); exact(item, [left, right], "pair"); if (!identifier(item[left]) || !identifier(item[right])) throw new Error("Invalid pair"); return { [left]: item[left], [right]: item[right] } as Record<string, string>; }
function scalarRecord(value: unknown): Record<string, string | number | boolean> { const item = record(value, "scalar record"); if (Object.values(item).some(v => typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) throw new Error("Invalid scalar record"); return structuredClone(item) as Record<string, string | number | boolean>; }
function stringRecord(value: unknown): Record<string, string> { const item = record(value, "string record"); if (Object.values(item).some(v => !identifier(v))) throw new Error("Invalid string record"); return structuredClone(item) as Record<string, string>; }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[], label: string): void { const allowed = new Set(keys), optional = new Set(["reason", "detail"]); if (Object.keys(value).some(key => !allowed.has(key)) || keys.some(key => !optional.has(key) && !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`Invalid ${label} keys`); }
function text(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function identifier(value: unknown): value is string { return text(value, 300) && value.trim() === value; }
function stringList(value: unknown, maximum: number): value is string[] { return Array.isArray(value) && value.length <= maximum && value.every(identifier); }
function instant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)); }
function unique(values: string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`); }
function measurementStatus(value: unknown): value is Epic537MeasurementStatus { return ["measured", "not_measured", "failed", "not_applicable"].includes(String(value)); }
function nullableNonNegative(value: unknown): boolean { return value === null || typeof value === "number" && Number.isFinite(value) && value >= 0; }
