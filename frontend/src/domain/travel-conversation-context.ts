import type { TripContext } from "@raiquora/trip/travel-profile";
import {
  isConversationExpectedInput,
  type ConversationExpectedInput,
} from "./conversation-guidance";

export interface TravelConversationFacts {
  context: TripContext;
  hasExplicitDate: boolean;
  hasExplicitStayLength: boolean;
}

/**
 * Extract only facts that came from the user's current conversation.
 * Model-proposed dates are deliberately not accepted as authoritative input.
 */
export function travelConversationFacts(
  prompt: string,
  now = new Date(),
): TravelConversationFacts {
  const previous = embeddedTripContext(prompt);
  const answer = continuedAnswer(prompt) ?? prompt;
  const expectedInput = embeddedExpectedInput(prompt);
  const answerDate = explicitCalendarDate(answer, now);
  const promptDate = explicitCalendarDate(prompt, now);
  const startDate = answerDate ?? previous.startDate ?? promptDate;
  const answerNights = explicitStayNights(answer, expectedInput);
  const planningStage = nextPlanningStage(
    previous.planningStage,
    answer,
    answerDate !== undefined || answerNights !== undefined,
  );
  const promptNights = explicitStayNights(prompt);
  const stayNights = answerNights ?? previous.stayNights ?? promptNights;
  const answerTimes = explicitTravelTimes(answer, prompt);
  const promptTimes = explicitTravelTimes(prompt);
  const outboundDepartureTimeMinutes = answerTimes.outboundDepartureTimeMinutes ??
    previous.outboundDepartureTimeMinutes ?? promptTimes.outboundDepartureTimeMinutes;
  const returnArrivalTimeMinutes = answerTimes.returnArrivalTimeMinutes ??
    previous.returnArrivalTimeMinutes ?? promptTimes.returnArrivalTimeMinutes;
  const previousEndDate = validIsoDateText(previous.endDate)
    ? previous.endDate
    : undefined;
  const endDate = startDate !== undefined && stayNights !== undefined
    ? stepIsoDate(startDate, stayNights)
    : previousEndDate;
  return {
    context: {
      ...previous,
      ...(planningStage ? { planningStage } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(stayNights === undefined ? {} : { stayNights }),
      ...(outboundDepartureTimeMinutes === undefined
        ? {}
        : { outboundDepartureTimeMinutes }),
      ...(returnArrivalTimeMinutes === undefined ? {} : { returnArrivalTimeMinutes }),
    },
    hasExplicitDate: Boolean(answerDate || previous.startDate || promptDate),
    hasExplicitStayLength: stayNights !== undefined || Boolean(previousEndDate),
  };
}

export function mergeAuthoritativeTripContext(
  candidate: TripContext,
  prompt: string,
  now = new Date(),
): TripContext {
  const facts = travelConversationFacts(prompt, now);
  const merged: TripContext = { ...candidate, ...facts.context };
  if (!facts.hasExplicitDate) {
    delete merged.startDate;
    delete merged.endDate;
  }
  if (!facts.hasExplicitStayLength) {
    delete merged.stayNights;
    delete merged.endDate;
  }
  if (facts.context.outboundDepartureTimeMinutes === undefined) {
    delete merged.outboundDepartureTimeMinutes;
  }
  if (facts.context.returnArrivalTimeMinutes === undefined) {
    delete merged.returnArrivalTimeMinutes;
  }
  return merged;
}

/** Apply explicit facts from one user answer before asking the model. */
export function tripContextAfterUserAnswer(
  current: TripContext,
  answer: string,
  expectedInput?: ConversationExpectedInput,
  now = new Date(),
): TripContext {
  return travelConversationFacts([
    `現在の旅行条件: ${JSON.stringify(current)}`,
    ...(expectedInput ? [`回答の種類: ${expectedInput}`] : []),
    `利用者の今回の回答: ${answer}`,
  ].join("\n"), now).context;
}

export function quickReplyMatchesExpectedInput(
  value: string,
  expectedInput: "planning-intent" | "departure-date" | "stay-length" | "traveler-count" | "free-text",
): boolean {
  if (expectedInput === "free-text") return true;
  const normalized = value.normalize("NFKC").trim();
  if (expectedInput === "planning-intent") {
    return /^(?:旅程を考えたい|この場所で考える|旅にしたい|もう少し見たい)$/u.test(normalized);
  }
  if (expectedInput === "departure-date") {
    return /^(?:今日|本日|明日|明後日|今週末|来週|別の日|other)$/u.test(normalized) ||
      /^\d{1,4}(?:年|[\/-])\d{1,2}(?:(?:月|[\/-])\d{1,2}日?)?$/u.test(normalized);
  }
  if (expectedInput === "stay-length") {
    return /^(?:日帰り|\d+泊)$/u.test(normalized);
  }
  return /\d+\s*(?:人|名)/u.test(normalized);
}

export function hasExplicitReturnArrivalTime(prompt: string): boolean {
  const answer = continuedAnswer(prompt) ?? prompt;
  return explicitTravelTimes(answer, prompt).returnArrivalTimeMinutes !== undefined;
}

function embeddedTripContext(prompt: string): TripContext {
  const match = prompt.match(/現在の旅行条件:\s*(\{[^\n]*\})/u);
  if (!match) return {};
  try {
    const value: unknown = JSON.parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    return {
      ...(input.planningStage === "inspiration" || input.planningStage === "planning"
        ? { planningStage: input.planningStage }
        : {}),
      ...(text(input.destinationWish) ? { destinationWish: text(input.destinationWish) } : {}),
      ...(validIsoDateText(input.startDate) ? { startDate: input.startDate } : {}),
      ...(validIsoDateText(input.endDate) ? { endDate: input.endDate } : {}),
      ...(boundedNights(input.stayNights) === undefined
        ? {}
        : { stayNights: boundedNights(input.stayNights) }),
      ...(boundedMinutes(input.outboundDepartureTimeMinutes) === undefined
        ? {}
        : { outboundDepartureTimeMinutes: boundedMinutes(input.outboundDepartureTimeMinutes) }),
      ...(boundedMinutes(input.returnArrivalTimeMinutes) === undefined
        ? {}
        : { returnArrivalTimeMinutes: boundedMinutes(input.returnArrivalTimeMinutes) }),
      ...(typeof input.pace === "number" && input.pace >= 0 && input.pace <= 1
        ? { pace: input.pace }
        : {}),
      ...(typeof input.maximumTravelMinutes === "number" || input.maximumTravelMinutes === null
        ? { maximumTravelMinutes: input.maximumTravelMinutes as number | null }
        : {}),
      ...(typeof input.carAvailable === "boolean"
        ? { carAvailable: input.carAvailable }
        : {}),
    };
  } catch {
    return {};
  }
}

function nextPlanningStage(
  previous: TripContext["planningStage"],
  answer: string,
  hasExplicitTravelCondition: boolean,
): TripContext["planningStage"] {
  if (previous === "planning") return previous;
  if (hasExplicitTravelCondition) return "planning";
  if (previous !== "inspiration") return previous;
  const normalized = answer.normalize("NFKC").replace(/[\s　]+/gu, "");
  return /(?:旅程|プラン|旅行)(?:を|に)?(?:考え|作り|組み|したい)|(?:この場所|ここ)(?:で|を軸に)(?:考え|旅に)/u.test(normalized)
    ? "planning"
    : previous;
}

function continuedAnswer(prompt: string): string | undefined {
  return prompt.match(/利用者の今回の回答:\s*([^\n]+)/u)?.[1]?.trim();
}

function embeddedExpectedInput(prompt: string): ConversationExpectedInput | undefined {
  const value = prompt.match(/回答の種類:\s*([^\n]+)/u)?.[1]?.trim();
  return isConversationExpectedInput(value) ? value : undefined;
}

function explicitStayNights(
  value: string,
  expectedInput?: ConversationExpectedInput,
): number | undefined {
  const normalized = value.normalize("NFKC");
  if (normalized.includes("日帰り")) return 0;
  if (expectedInput === "stay-length" && /^\s*1日(?:間)?\s*$/u.test(normalized)) return 0;
  const times = explicitTravelTimes(normalized);
  if (times.outboundDepartureTimeMinutes !== undefined &&
      times.returnArrivalTimeMinutes !== undefined) return 0;
  return boundedNights(Number(normalized.match(/(\d{1,2})泊/u)?.[1]));
}

function explicitTravelTimes(value: string, conversation = value): Pick<TripContext,
  "outboundDepartureTimeMinutes" | "returnArrivalTimeMinutes"> {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, "");
  const clock = "(?:(朝|午前|昼|午後|夕方|夜)(?:の)?)?(\\d{1,2})(?::(\\d{1,2})|時(?:(\\d{1,2})分)?)";
  const directReturnArrivalTimeMinutes = clockBefore(
    normalized,
    clock,
    /^(?:には?|までに?)?(?:家|自宅)?(?:に)?(?:着|到着|ついて|帰って|帰宅)/u,
  );
  const returnArrivalTimeMinutes = directReturnArrivalTimeMinutes ??
    contextualReturnArrivalTime(normalized, conversation, clock);
  const outboundDepartureTimeMinutes = clockBefore(
    normalized,
    clock,
    /^(?:には?|から)?(?:家を)?(?:出発|出て|出る)/u,
  );
  return {
    ...(returnArrivalTimeMinutes === undefined ? {} : { returnArrivalTimeMinutes }),
    ...(outboundDepartureTimeMinutes === undefined ? {} : { outboundDepartureTimeMinutes }),
  };
}

function contextualReturnArrivalTime(
  answer: string,
  conversation: string,
  clock: string,
): number | undefined {
  const context = conversation.normalize("NFKC");
  if (!/直前の質問:[^\n]*(?:帰り|帰路|帰宅|家|自宅|到着希望時刻)/u.test(context)) {
    return undefined;
  }
  if (!/(?:到着|着く|着き|帰宅|帰る)/u.test(answer)) return undefined;
  const match = answer.match(new RegExp(clock, "u"));
  if (!match) return undefined;
  return clockMatchMinutes(match);
}

function clockMatchMinutes(match: RegExpMatchArray): number | undefined {
  const hour = Number(match[2]);
  const minute = Number(match[3] ?? match[4] ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 29 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  const period = match[1];
  const adjustedHour = (period === "午後" || period === "夕方" || period === "夜") &&
      hour < 12 ? hour + 12 : period === "朝" && hour === 12 ? 0 : hour;
  return adjustedHour * 60 + minute;
}

function clockBefore(value: string, pattern: string, suffix: RegExp): number | undefined {
  const matches = value.matchAll(new RegExp(pattern, "gu"));
  for (const match of matches) {
    const end = (match.index ?? 0) + match[0].length;
    if (!suffix.test(value.slice(end, end + 18))) continue;
    const minutes = clockMatchMinutes(match);
    if (minutes !== undefined) return minutes;
  }
  return undefined;
}

function boundedNights(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 30
    ? value
    : undefined;
}

function boundedMinutes(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_800
    ? value
    : undefined;
}

function explicitCalendarDate(value: string, now: Date): string | undefined {
  const normalized = value.normalize("NFKC");
  const reference = calendarDateInJapan(now);
  if (normalized.includes("明後日")) return stepIsoDate(reference, 2);
  if (normalized.includes("明日")) return stepIsoDate(reference, 1);
  if (normalized.includes("今日") || normalized.includes("本日")) return reference;
  const full = normalized.match(/(\d{4})(?:年|[\/-])(\d{1,2})(?:月|[\/-])(\d{1,2})日?/u);
  if (full) return validIsoDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const monthDay = normalized.match(/(?:^|\D)(\d{1,2})(?:月|\/)(\d{1,2})日?/u);
  if (!monthDay) return undefined;
  const year = Number(reference.slice(0, 4));
  const candidate = validIsoDate(year, Number(monthDay[1]), Number(monthDay[2]));
  if (!candidate) return undefined;
  return candidate < reference
    ? validIsoDate(year + 1, Number(monthDay[1]), Number(monthDay[2]))
    : candidate;
}

function calendarDateInJapan(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function stepIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validIsoDate(year: number, month: number, day: number): string | undefined {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIsoDateText(value) ? value : undefined;
}

function validIsoDateText(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : undefined;
}
