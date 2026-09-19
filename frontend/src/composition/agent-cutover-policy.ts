export type ConsultationTransport = "server" | "browser-development" | "stopped";

/** Production rollback stops consultation; it never reopens the Browser model loop. */
export function consultationTransport(serverEnabled: boolean, development: boolean): ConsultationTransport {
  return serverEnabled ? "server" : development ? "browser-development" : "stopped";
}
