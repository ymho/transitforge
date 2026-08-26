export interface LambdaHttpEvent {
  requestContext?: { http?: { method?: string } };
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface LambdaContext {
  awsRequestId?: string;
  aws_request_id?: string;
}

export interface LambdaHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function jsonResponse(
  statusCode: number,
  body: Record<string, unknown>,
  requestId?: string,
): LambdaHttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(requestId ? { "x-transitforge-request-id": requestId } : {}),
    },
    body: JSON.stringify(body),
  };
}
