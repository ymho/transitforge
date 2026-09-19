export type ConsultationTransport = "server" | "stopped";

/** Production rollback stops consultation; it never reopens the Browser model loop. */
export function consultationTransport(serverEnabled: boolean): ConsultationTransport {
  return serverEnabled ? "server" : "stopped";
}
