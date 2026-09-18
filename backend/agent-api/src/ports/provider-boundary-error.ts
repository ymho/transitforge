export const providerErrorRetryable = {
  invalid_request: false, provider_timeout: true, provider_4xx: false,
  provider_throttled: true, provider_5xx: true, malformed_response: false,
  oversized_result: false, unavailable: true,
} as const;
export type ProviderErrorCode = keyof typeof providerErrorRetryable;
export class ProviderBoundaryError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: ProviderErrorCode) {
    super("宿泊提供者の検索を利用できません。");
    this.retryable = providerErrorRetryable[code];
  }
}
