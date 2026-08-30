export interface BraveSearchCredentialsRepository {
  load(): Promise<{ apiKey: string } | undefined>;
}
