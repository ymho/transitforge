import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const viewerInputFiles: Record<string, string> = {
  "/viewer-input/train_index.json": "train_index.json",
  "/viewer-input/path_catalog.json": "path_catalog.json",
};
const trainCongestionPath = "/api/westjr/trainmonitorinfo.json";
const trainCongestionUrl =
  "https://www.train-guide.westjr.co.jp/api/v3/trainmonitorinfo.json";
const trainCongestionCacheMilliseconds = 5 * 60 * 1_000;
const trainDelayPath = "/api/westjr/delays.json";
const trainDelaySourceIds = [
  "hokuriku", "kobesanyo", "hokurikubiwako", "kyoto", "ako", "kosei",
  "kusatsu", "nara", "sagano", "sanin1", "sanin2", "osakahigashi",
  "takarazuka", "osakaloop", "gakkentoshi", "tozai", "hanwahagoromo",
  "yumesaki", "yamatoji", "yamatojiosakahigashi", "kansaiairport",
  "wakayama1", "kinokuni", "manyomahoroba", "kansai", "bantan",
] as const;

interface CachedTrainCongestion {
  body: Uint8Array;
  contentType: string;
  fetchedAt: number;
}

type CachedTrainDelay = CachedTrainCongestion;

export default defineConfig({
  plugins: [
    {
      name: "serve-local-viewer-input",
      configureServer(server) {
        const viewerInputDirectory = resolve(process.cwd(), "viewer-input");
        let cachedTrainCongestion: CachedTrainCongestion | undefined;
        let pendingTrainCongestion: Promise<CachedTrainCongestion> | undefined;
        let cachedTrainDelay: CachedTrainDelay | undefined;
        let pendingTrainDelay: Promise<CachedTrainDelay> | undefined;

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

          if (pathname === trainDelayPath) {
            if (request.method !== "GET" && request.method !== "HEAD") {
              response.statusCode = 405;
              response.setHeader("Allow", "GET, HEAD");
              response.end();
              return;
            }
            try {
              const now = Date.now();
              if (
                !cachedTrainDelay ||
                now - cachedTrainDelay.fetchedAt >=
                  trainCongestionCacheMilliseconds
              ) {
                pendingTrainDelay ??= fetchTrainDelays().finally(() => {
                  pendingTrainDelay = undefined;
                });
                cachedTrainDelay = await pendingTrainDelay;
              }
              response.setHeader("Content-Type", cachedTrainDelay.contentType);
              response.setHeader(
                "Cache-Control",
                `public, max-age=${trainCongestionCacheMilliseconds / 1_000}`,
              );
              response.setHeader(
                "X-TransitForge-Cache-Age",
                String(
                  Math.max(
                    0,
                    Math.floor((Date.now() - cachedTrainDelay.fetchedAt) / 1_000),
                  ),
                ),
              );
              response.end(
                request.method === "HEAD" ? undefined : cachedTrainDelay.body,
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

async function fetchTrainDelays(): Promise<CachedTrainDelay> {
  const collectedAt = new Date().toISOString();
  const results: Array<{ sourceId: string; value?: unknown }> = [];
  for (let offset = 0; offset < trainDelaySourceIds.length; offset += 4) {
    const batch = trainDelaySourceIds.slice(offset, offset + 4);
    results.push(
      ...(await Promise.all(
        batch.map(async (sourceId) => {
          try {
            const response = await fetch(
              `https://www.train-guide.westjr.co.jp/api/v3/${sourceId}.json`,
              { headers: { Accept: "application/json" } },
            );
            if (!response.ok) {
              return { sourceId };
            }
            return { sourceId, value: await response.json() };
          } catch {
            return { sourceId };
          }
        }),
      )),
    );
  }
  const failedSources: string[] = [];
  const sourceUpdates: Record<string, string> = {};
  const trains: Record<string, Record<string, unknown>> = {};
  for (const result of results) {
    const { sourceId } = result;
    if (!isRecord(result.value)) {
      failedSources.push(sourceId);
      continue;
    }
    const snapshot = result.value;
    if (typeof snapshot.update !== "string" || !Array.isArray(snapshot.trains)) {
      failedSources.push(sourceId);
      continue;
    }
    sourceUpdates[sourceId] = snapshot.update;
    for (const value of snapshot.trains) {
      if (!isRecord(value) || typeof value.no !== "string") {
        continue;
      }
      const delay = value.delayMinutes ?? value.delayMinites;
      if (
        typeof delay !== "number" ||
        !Number.isFinite(delay) ||
        delay < 0
      ) {
        continue;
      }
      const existing = trains[value.no];
      const sources = Array.isArray(existing?.sources)
        ? [...existing.sources, sourceId]
        : [sourceId];
      const destination = isRecord(value.dest) ? value.dest.text : "";
      trains[value.no] = {
        delayMinutes: Math.max(
          delay,
          typeof existing?.delayMinutes === "number"
            ? existing.delayMinutes
            : 0,
        ),
        sources,
        displayType: value.displayType ?? "",
        nickname: value.nickname ?? "",
        destination: typeof destination === "string" ? destination : "",
      };
    }
  }
  if (Object.keys(sourceUpdates).length === 0) {
    throw new Error("JR西日本列車遅延情報を取得できませんでした。");
  }
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ collectedAt, sourceUpdates, failedSources, trains }),
    ),
    contentType: "application/json; charset=utf-8",
    fetchedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
