import type { ReservationFact } from "@raiquora/trip/reservation";

/** Read-only authenticated transport seam. No private reservation detail or client owner field. */
export interface ReservationReadClient { list(tripId: string): Promise<ReservationFact[]>; }
export const reservationStatusLabels: Record<ReservationFact["status"], string> = {
  booked: "予約済み", "not-booked": "未予約", "not-required": "予約不要", cancelled: "キャンセル済み", unknown: "未確認",
};
