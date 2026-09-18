import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import type { StreamRequest, StreamWriter } from "../../ports/agent-stream-transport.js";

/** AWS event/stream types stop here, outside the Application and Runtime core. */
export interface RestStreamEvent {
  requestContext?: { extendedRequestId?: string };
  httpMethod?: string; path?: string; headers?: StreamRequest["headers"]; multiValueHeaders?: StreamRequest["multiValueHeaders"];
  queryStringParameters?: Record<string, string> | null; body?: string | null; isBase64Encoded?: boolean;
}
export interface LambdaStreamingApi {
  streamifyResponse(handler: (event: RestStreamEvent, output: Writable, context?: { awsRequestId?: string }) => Promise<void>): unknown;
  HttpResponseStream: { from(output: Writable, metadata: { statusCode: number; headers: Record<string, string> }): Writable };
}
export function lambdaStreamHandler(api: LambdaStreamingApi, handle: (request: StreamRequest, writer: StreamWriter) => Promise<void>) {
  return api.streamifyResponse(async (event, raw, context) => {
    const controller = new AbortController();
    let output = raw;
    const closed = () => { if (!output.writableFinished) controller.abort(); };
    raw.on("close", closed); raw.on("error", () => controller.abort());
    await handle({ apiRequestId: event.requestContext?.extendedRequestId, lambdaRequestId: context?.awsRequestId, method: event.httpMethod, path: event.path, headers: event.headers, multiValueHeaders: event.multiValueHeaders,
      query: event.queryStringParameters, body: event.body, isBase64Encoded: event.isBase64Encoded }, {
      signal: controller.signal,
      start: (statusCode, headers) => { output = api.HttpResponseStream.from(raw, { statusCode, headers }); },
      write: frame => new Promise<void>((resolve, reject) => { output.write(frame, error => error ? reject(error) : resolve()); }),
      end: async () => { if (!output.destroyed) { output.end(); await finished(output); } },
    });
  });
}
