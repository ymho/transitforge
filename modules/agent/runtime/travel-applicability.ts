export type ApplicabilityExtractionKind = "provider_structured" | "model_extracted" | "human_verified";

export interface ApplicabilitySourceSpan {
  text: string;
  start: number;
  end: number;
}

interface ApplicabilityBase {
  observationId: string;
  subjectRef: string;
  validDuring?: { from?: string; until?: string };
  applicabilityScope: string;
  sourceRef: string;
  sourceSpan?: ApplicabilitySourceSpan;
  retrievedAt: string;
  extractionKind: ApplicabilityExtractionKind;
}

export interface LocalOpeningWindow {
  weekdays?: number[];
  dates?: string[];
  opensMinute: number;
  closesMinute: number;
  lastAdmissionMinute?: number;
}

export type TravelApplicabilityFact =
  | ApplicabilityBase & { kind: "opening_windows"; timeZone: string; windows: LocalOpeningWindow[]; closedDates?: string[] }
  | ApplicabilityBase & { kind: "access_requirement"; originRef: string; destinationRef: string; mode: "walking" | "driving" | "cycling" | "rail" | "bus" | "other"; lowerBoundMinutes: number }
  | ApplicabilityBase & { kind: "visit_requirement"; reservation: "required" | "not_required" | "unknown"; participantRequirements?: Array<{ field: string; operator: "equals" | "minimum" | "maximum"; value: string | number }> }
  | ApplicabilityBase & { kind: "seasonal_relevance"; months: number[]; note?: string };

export interface VisitScope {
  subjectRef: string;
  scopeRef: string;
  calendarDate?: string;
  minuteOfDay?: number;
  timeZone?: string;
  originRef?: string;
  destinationRef?: string;
  mode?: "walking" | "driving" | "cycling" | "rail" | "bus" | "other";
  participantFacts?: Record<string, string | number | boolean>;
  locationResolved: boolean;
}

export interface ApplicabilityAssessment {
  status: "match" | "mismatch" | "unknown";
  reason: string;
  observationId: string;
  feasibilityUse: "allowed" | "recommendation_only" | "blocked";
}

export function assessApplicability(fact: TravelApplicabilityFact, visit: VisitScope): ApplicabilityAssessment {
  const result = (status: ApplicabilityAssessment["status"], reason: string,
    feasibilityUse: ApplicabilityAssessment["feasibilityUse"] = status === "match" ? "allowed" : "blocked"): ApplicabilityAssessment =>
    ({ status, reason, observationId: fact.observationId, feasibilityUse });
  if (fact.subjectRef !== visit.subjectRef) return result("mismatch", "subject_mismatch");
  if (fact.applicabilityScope !== visit.scopeRef) return result("unknown", "outside_observed_scope");
  if (!visit.locationResolved) return result("unknown", "location_unresolved");
  if (visit.calendarDate && !withinValidity(visit.calendarDate, fact.validDuring)) return result("unknown", "outside_valid_time");

  if (fact.kind === "seasonal_relevance") {
    if (!visit.calendarDate) return result("unknown", "date_unscheduled", "recommendation_only");
    const month = Number(visit.calendarDate.slice(5, 7));
    return result(fact.months.includes(month) ? "match" : "mismatch", "seasonal_relevance", "recommendation_only");
  }
  if (fact.kind === "access_requirement") {
    if (!visit.originRef || !visit.destinationRef || !visit.mode) return result("unknown", "access_scope_incomplete");
    return result(fact.originRef === visit.originRef && fact.destinationRef === visit.destinationRef && fact.mode === visit.mode ? "match" : "mismatch", "access_scope_checked");
  }
  if (fact.kind === "visit_requirement") {
    if (fact.reservation === "unknown") return result("unknown", "reservation_unknown");
    for (const requirement of fact.participantRequirements ?? []) {
      const actual = visit.participantFacts?.[requirement.field];
      if (actual === undefined) return result("unknown", `participant_unknown:${requirement.field}`);
      if (!requirementMatches(actual, requirement)) return result("mismatch", `participant_mismatch:${requirement.field}`);
    }
    return result("match", "visit_requirements_checked");
  }
  if (!visit.calendarDate || visit.minuteOfDay === undefined || !visit.timeZone) return result("unknown", "visit_time_incomplete");
  if (visit.timeZone !== fact.timeZone) return result("unknown", "time_zone_mismatch");
  if (fact.closedDates?.includes(visit.calendarDate)) return result("mismatch", "exception_closed");
  const weekday = new Date(`${visit.calendarDate}T12:00:00Z`).getUTCDay();
  const matching = fact.windows.filter((openingWindow) => openingWindowApplies(
    openingWindow, visit.calendarDate!, weekday, visit.minuteOfDay!,
  ));
  if (!matching.length) return result("unknown", "opening_window_not_observed");
  const open = matching.some((openingWindow) => minuteInWindow(visit.minuteOfDay!, openingWindow));
  return result(open ? "match" : "mismatch", open ? "within_opening_window" : "outside_opening_window");
}

export function normalizeProviderApplicability(value: unknown): TravelApplicabilityFact {
  if (!record(value)) throw new Error("Invalid provider applicability fact");
  return validateFact({ ...value, extractionKind: "provider_structured" });
}

export function parseExtractedApplicability(input: { fact: unknown; sourceText: string }): TravelApplicabilityFact {
  if (!record(input.fact)) throw new Error("Invalid extracted applicability fact");
  const fact = validateFact({ ...input.fact, extractionKind: "model_extracted" });
  const span = fact.sourceSpan;
  if (!span || span.start < 0 || span.end <= span.start || span.end > input.sourceText.length ||
      input.sourceText.slice(span.start, span.end) !== span.text) throw new Error("Unbound applicability source span");
  return fact;
}

function validateFact(value: Record<string, unknown>): TravelApplicabilityFact {
  for (const field of ["observationId", "subjectRef", "applicabilityScope", "sourceRef", "retrievedAt", "kind", "extractionKind"] as const) {
    if (typeof value[field] !== "string" || !String(value[field]).trim()) throw new Error(`Invalid applicability ${field}`);
  }
  if (!isIso(value.retrievedAt)) throw new Error("Invalid applicability retrievedAt");
  if (value.sourceSpan !== undefined && (!record(value.sourceSpan) || typeof value.sourceSpan.text !== "string" ||
      !Number.isInteger(value.sourceSpan.start) || !Number.isInteger(value.sourceSpan.end))) throw new Error("Invalid applicability sourceSpan");
  if (value.kind === "opening_windows") {
    if (typeof value.timeZone !== "string" || !Array.isArray(value.windows) || value.windows.some((candidateWindow) => !openingWindow(candidateWindow))) throw new Error("Invalid opening windows");
  } else if (value.kind === "access_requirement") {
    if (typeof value.originRef !== "string" || typeof value.destinationRef !== "string" ||
        !["walking", "driving", "cycling", "rail", "bus", "other"].includes(String(value.mode)) || !nonNegativeInt(value.lowerBoundMinutes)) throw new Error("Invalid access requirement");
  } else if (value.kind === "visit_requirement") {
    if (!["required", "not_required", "unknown"].includes(String(value.reservation))) throw new Error("Invalid visit requirement");
  } else if (value.kind === "seasonal_relevance") {
    if (!Array.isArray(value.months) || !value.months.length || value.months.some((month) => !Number.isInteger(month) || Number(month) < 1 || Number(month) > 12)) throw new Error("Invalid seasonal relevance");
  } else throw new Error("Unsupported applicability kind");
  return value as unknown as TravelApplicabilityFact;
}

function openingWindow(value: unknown): boolean {
  return record(value) && nonNegativeInt(value.opensMinute) && Number(value.opensMinute) < 1440 && nonNegativeInt(value.closesMinute) && Number(value.closesMinute) < 1440 &&
    (value.lastAdmissionMinute === undefined || nonNegativeInt(value.lastAdmissionMinute) && Number(value.lastAdmissionMinute) < 1440) &&
    (value.weekdays === undefined || Array.isArray(value.weekdays) && value.weekdays.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)) &&
    (value.dates === undefined || Array.isArray(value.dates) && value.dates.every(calendarDate));
}
function minuteInWindow(minute: number, opening: LocalOpeningWindow): boolean {
  const latest = opening.lastAdmissionMinute ?? opening.closesMinute;
  return opening.opensMinute <= opening.closesMinute
    ? minute >= opening.opensMinute && minute <= latest
    : minute >= opening.opensMinute || minute <= latest;
}
function openingWindowApplies(opening: LocalOpeningWindow, calendarDateValue: string, weekday: number, minute: number): boolean {
  const continuesFromPreviousDay = opening.opensMinute > opening.closesMinute && minute <= opening.closesMinute;
  const serviceDate = continuesFromPreviousDay ? previousCalendarDate(calendarDateValue) : calendarDateValue;
  const serviceWeekday = continuesFromPreviousDay ? (weekday + 6) % 7 : weekday;
  return (!opening.dates || opening.dates.includes(serviceDate)) && (!opening.weekdays || opening.weekdays.includes(serviceWeekday));
}
function previousCalendarDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function requirementMatches(actual: unknown, requirement: { operator: string; value: string | number }): boolean {
  if (requirement.operator === "equals") return actual === requirement.value;
  return typeof actual === "number" && typeof requirement.value === "number" &&
    (requirement.operator === "minimum" ? actual >= requirement.value : actual <= requirement.value);
}
function withinValidity(date: string, validity?: { from?: string; until?: string }): boolean {
  return (!validity?.from || date >= validity.from.slice(0, 10)) && (!validity?.until || date <= validity.until.slice(0, 10));
}
function nonNegativeInt(value: unknown): boolean { return Number.isInteger(value) && Number(value) >= 0; }
function calendarDate(value: unknown): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value); }
function isIso(value: unknown): boolean { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
