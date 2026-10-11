import { build } from "esbuild";
const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) throw new Error("entry and outfile required");
const options = { bundle: true, platform: "node", target: "node22", format: "cjs" };
const worker = await build({ ...options, entryPoints: ["src/adapters/journey-search-worker-entry.ts"], write: false });
await build({ ...options, entryPoints: [entry], outfile, plugins: [{ name: "journey-worker", setup(builder) {
  builder.onLoad({ filter: /journey-search-worker-source\.ts$/ }, () => ({ contents: `export default ${JSON.stringify(worker.outputFiles[0].text)};`, loader: "js" }));
} }] });
