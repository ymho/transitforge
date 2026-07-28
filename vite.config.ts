import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const viewerInputFiles: Record<string, string> = {
  "/viewer-input/train_index.json": "train_index.json",
  "/viewer-input/path_catalog.json": "path_catalog.json",
  "/viewer-input/station_line_catalog.json": "station_line_catalog.json",
};

export default defineConfig({
  plugins: [
    {
      name: "serve-local-viewer-input",
      configureServer(server) {
        const viewerInputDirectory = resolve(process.cwd(), "viewer-input");

        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
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
