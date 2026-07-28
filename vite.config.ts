import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const viewerInputFiles: Record<string, string> = {
  "/viewer-input/train_index.json": "train_index.json",
  "/viewer-input/path_catalog.json": "path_catalog.json",
  "/viewer-input/station_line_catalog.json": "station_line_catalog.json",
};
const trainCongestionPath = "/api/westjr/trainmonitorinfo.json";
const trainCongestionUrl =
  "https://www.train-guide.westjr.co.jp/api/v3/trainmonitorinfo.json";
const trainCongestionCacheMilliseconds = 5 * 60 * 1_000;

interface CachedTrainCongestion {
  body: Uint8Array;
  contentType: string;
  fetchedAt: number;
}

export default defineConfig({
  plugins: [
    {
      name: "serve-local-viewer-input",
      configureServer(server) {
        const viewerInputDirectory = resolve(process.cwd(), "viewer-input");
        let cachedTrainCongestion: CachedTrainCongestion | undefined;
        let pendingTrainCongestion: Promise<CachedTrainCongestion> | undefined;

        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

          if (pathname === trainCongestionPath) {
            if (request.method !== "GET" && request.method !== "HEAD") {
              response.statusCode = 405;
              response.setHeader("Allow", "GET, HEAD");
              response.end();
              return;
            }

            try {
              const now = Date.now();
              if (
                !cachedTrainCongestion ||
                now - cachedTrainCongestion.fetchedAt >=
                  trainCongestionCacheMilliseconds
              ) {
                pendingTrainCongestion ??= fetchTrainCongestion().finally(() => {
                  pendingTrainCongestion = undefined;
                });
                cachedTrainCongestion = await pendingTrainCongestion;
              }

              response.setHeader(
                "Content-Type",
                cachedTrainCongestion.contentType,
              );
              response.setHeader(
                "Cache-Control",
                `public, max-age=${trainCongestionCacheMilliseconds / 1_000}`,
              );
              response.setHeader(
                "X-TransitForge-Cache-Age",
                String(
                  Math.max(
                    0,
                    Math.floor(
                      (Date.now() - cachedTrainCongestion.fetchedAt) / 1_000,
                    ),
                  ),
                ),
              );
              response.end(
                request.method === "HEAD"
                  ? undefined
                  : cachedTrainCongestion.body,
              );
            } catch (error) {
              next(error);
            }
            return;
          }

          const filename = viewerInputFiles[pathname];

          if (!filename) {
            next();
            return;
          }

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          createReadStream(resolve(viewerInputDirectory, filename))
            .on("error", next)
            .pipe(response);
        });
      },
    },
  ],
});

async function fetchTrainCongestion(): Promise<CachedTrainCongestion> {
  const upstream = await fetch(trainCongestionUrl, {
    headers: { Accept: "application/json" },
  });
  if (!upstream.ok) {
    throw new Error(
      `JR西日本列車混雑情報の取得に失敗しました (${upstream.status})。`,
    );
  }

  return {
    body: new Uint8Array(await upstream.arrayBuffer()),
    contentType:
      upstream.headers.get("content-type") ??
      "application/json; charset=utf-8",
    fetchedAt: Date.now(),
  };
}
