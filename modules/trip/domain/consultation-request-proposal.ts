import { exactKeys } from "./snapshot-validation";
import { parseConsultationRequest } from "./consultation-request";
import type { TripRequest } from "./trip-request";

/** A reviewable Conversation draft change, never an adopted Trip update. */
export interface ConsultationRequestProposal {
  conversationId: string;
  baseRequest: TripRequest;
  request: TripRequest;
  summary: string;
}
export function parseConsultationRequestProposal(value: unknown): ConsultationRequestProposal {
  const raw = JSON.stringify(value);
  if (!raw || new TextEncoder().encode(raw).length > 32_768) throw new Error("Consultation proposal exceeds limit");
  const p = JSON.parse(raw) as ConsultationRequestProposal;
  exactKeys(p, ["conversationId", "baseRequest", "request", "summary"]);
  if (typeof p.conversationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(p.conversationId) ||
      typeof p.summary !== "string" || !p.summary.trim() || p.summary.length > 500) throw new Error("Invalid consultation proposal");
  return { ...p, baseRequest: parseConsultationRequest(p.baseRequest), request: parseConsultationRequest(p.request) };
}
/** Message appends advance Conversation revision; compare request values, then CAS fresh metadata on save. */
export function reviewConsultationRequestProposal(value: unknown, conversationId: string, currentRequest: TripRequest): ConsultationRequestProposal {
  const p = parseConsultationRequestProposal(value);
  if (p.conversationId !== conversationId || JSON.stringify(p.baseRequest) !== JSON.stringify(currentRequest)) throw new Error("条件が更新されています。現在の相談で変更案を作り直してください。");
  return p;
}
