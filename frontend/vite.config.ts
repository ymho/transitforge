import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const localDataFiles: Record<string, string> = {
  "/viewer-input/train_index.json": "train_index.json",
  "/viewer-input/path_catalog.json": "path_catalog.json",
  "/api/traffic/congestion.json": "congestion.json",
  "/api/traffic/delays.json": "delays.json",
};

const optionalLocalDataFallbacks: Record<string, string> = {
  "/api/traffic/congestion.json": JSON.stringify({
    update: "1970-01-01T00:00:00.000Z",
    trains: {},
  }),
  "/api/traffic/delays.json": JSON.stringify({
    collectedAt: "1970-01-01T00:00:00.000Z",
    failedSources: ["local-file-missing"],
    trains: {},
  }),
};

export default defineConfig({
  envDir: "..",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Mapbox is isolated from the initial application chunk and guarded by the
    // explicit per-family budget in tools/check_bundle_budget.mjs.
    chunkSizeWarningLimit: 1_900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/mapbox-gl")) return "mapbox";
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/zod")) return "validation";
          return undefined;
        },
      },
    },
  },
  plugins: [
    {
      name: "serve-local-data-files",
      configureServer(server) {
        const viewerInputDirectory = resolve(import.meta.dirname, "..", "viewer-input");

        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
          const filename = localDataFiles[pathname];

          if (!filename) {
            next();
            return;
          }
          if (request.method !== "GET" && request.method !== "HEAD") {
            response.statusCode = 405;
            response.setHeader("Allow", "GET, HEAD");
            response.end();
            return;
          }

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          const filepath = resolve(viewerInputDirectory, filename);
          if (!existsSync(filepath)) {
            const fallback = optionalLocalDataFallbacks[pathname];
            if (fallback !== undefined) {
              response.statusCode = 200;
              response.end(request.method === "HEAD" ? undefined : fallback);
              return;
            }
            response.statusCode = 404;
            response.end();
            return;
          }
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          createReadStream(filepath)
            .on("error", next)
            .pipe(response);
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
