export interface StreamRequest {
  method?: string;
  path?: string;
  headers?: Record<string, string | undefined>;
  multiValueHeaders?: Record<string, string[] | undefined>;
  query?: Record<string, unknown> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}
export interface StreamWriter {
  start(status: number, headers: Record<string, string>): void;
  write(frame: string): Promise<void>;
  end(): Promise<void>;
  signal: AbortSignal;
}
