import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const localDataFiles: Record<string, string> = {
  "/viewer-input/train_index.json": "train_index.json",
  "/viewer-input/path_catalog.json": "path_catalog.json",
  "/api/traffic/congestion.json": "congestion.json",
  "/api/traffic/delays.json": "delays.json",
};

export default defineConfig({
  plugins: [
    {
      name: "serve-local-data-files",
      configureServer(server) {
        const viewerInputDirectory = resolve(process.cwd(), "viewer-input");

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
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          createReadStream(resolve(viewerInputDirectory, filename))
            .on("error", next)
            .pipe(response);
        });
      },
    },
  ],
});
