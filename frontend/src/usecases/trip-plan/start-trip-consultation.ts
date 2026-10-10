import type { ConsultationStartResult } from "./server-trip-client";
import { validateTrip } from "@raiquora/trip/trip";

/** One idempotent server start, then explicit read-back/activation, then first prompt.
 * A failure never archives anything: both resources may already have committed. */
export async function startTripConsultation(input: {
  prompt: string; tripId: string;
  isCurrent(): boolean;
  start(value: { tripId: string; title: string; userRequest: string }): Promise<ConsultationStartResult>;
  activate(conversationId: string, tripId: string): Promise<void>;
  current(): { conversationId: string; tripId?: string };
  submit(prompt: string): void;
}): Promise<ConsultationStartResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Empty consultation");
  const check = () => { if (!input.isCurrent()) throw new Error("Consultation navigation changed"); };
  check();
  const line = prompt.replace(/\s+/gu, " ");
  const title = line.length > 40 ? `${line.slice(0, 39)}…` : line;
  const started = await input.start({ tripId: input.tripId, title, userRequest: prompt });
  check();
  if ("status" in started) return structuredClone(started);
  validateTrip(started.trip);
  if (started.trip.id !== input.tripId || started.conversationId !== input.tripId) throw new Error("Wrong Trip consultation result");
  await input.activate(started.conversationId, input.tripId);
  check();
  const current = input.current();
  if (current.conversationId !== started.conversationId || current.tripId !== input.tripId) throw new Error("Trip consultation activation changed");
  input.submit(prompt);
  return structuredClone(started);
}
