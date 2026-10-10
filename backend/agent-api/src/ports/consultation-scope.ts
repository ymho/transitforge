/** Read-only admission before creating any Trip or its conversation. */
export interface ConsultationScope {
  classify(userRequest: string): Promise<"travel" | "out-of-scope">;
}
