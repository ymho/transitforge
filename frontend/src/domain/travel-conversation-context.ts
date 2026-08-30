import type { TripContext } from "@raiquora/trip/travel-profile";

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
  const answerDate = explicitCalendarDate(answer, now);
  const promptDate = explicitCalendarDate(prompt, now);
  const startDate = answerDate ?? previous.startDate ?? promptDate;
  const answerNights = explicitStayNights(answer);
  const promptNights = explicitStayNights(prompt);
  const stayNights = answerNights ?? previous.stayNights ?? promptNights;
  const previousEndDate = validIsoDateText(previous.endDate)
    ? previous.endDate
    : undefined;
  const endDate = startDate !== undefined && stayNights !== undefined
    ? stepIsoDate(startDate, stayNights)
    : previousEndDate;
  return {
    context: {
      ...previous,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(stayNights === undefined ? {} : { stayNights }),
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
  return merged;
}

/** Apply explicit facts from one user answer before asking the model. */
export function tripContextAfterUserAnswer(
  current: TripContext,
  answer: string,
  now = new Date(),
): TripContext {
  return travelConversationFacts([
    `現在の旅行条件: ${JSON.stringify(current)}`,
    `利用者の今回の回答: ${answer}`,
  ].join("\n"), now).context;
}

export function quickReplyMatchesExpectedInput(
  value: string,
  expectedInput: "departure-date" | "stay-length" | "traveler-count" | "free-text",
): boolean {
  if (expectedInput === "free-text") return true;
  const normalized = value.normalize("NFKC").trim();
  if (expectedInput === "departure-date") {
    return /^(?:今日|本日|明日|明後日|今週末|来週|別の日|other)$/u.test(normalized) ||
      /^\d{1,4}(?:年|[\/-])\d{1,2}(?:(?:月|[\/-])\d{1,2}日?)?$/u.test(normalized);
  }
  if (expectedInput === "stay-length") {
    return /^(?:日帰り|\d+泊)$/u.test(normalized);
  }
  return /\d+\s*(?:人|名)/u.test(normalized);
}

function embeddedTripContext(prompt: string): TripContext {
  const match = prompt.match(/現在の旅行条件:\s*(\{[^\n]*\})/u);
  if (!match) return {};
  try {
    const value: unknown = JSON.parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    return {
      ...(text(input.destinationWish) ? { destinationWish: text(input.destinationWish) } : {}),
      ...(validIsoDateText(input.startDate) ? { startDate: input.startDate } : {}),
      ...(validIsoDateText(input.endDate) ? { endDate: input.endDate } : {}),
      ...(boundedNights(input.stayNights) === undefined
        ? {}
        : { stayNights: boundedNights(input.stayNights) }),
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

function continuedAnswer(prompt: string): string | undefined {
  return prompt.match(/利用者の今回の回答:\s*([^\n]+)/u)?.[1]?.trim();
}

function explicitStayNights(value: string): number | undefined {
  const normalized = value.normalize("NFKC");
  if (normalized.includes("日帰り")) return 0;
  return boundedNights(Number(normalized.match(/(\d{1,2})泊/u)?.[1]));
}

function boundedNights(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 30
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
