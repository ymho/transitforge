import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function compactTrainIndex(source) {
  if (
    source === null ||
    typeof source !== "object" ||
    source.schema_version !== "train-index-v1" ||
    typeof source.path_catalog !== "string" ||
    !Array.isArray(source.trains)
  ) {
    throw new Error("train_index.jsonの形式が不正です。");
  }

  keepKeys(source, ["schema_version", "path_catalog", "trains"]);
  for (const train of source.trains) {
    if (
      train === null ||
      typeof train !== "object" ||
      !Array.isArray(train.stops)
    ) {
      throw new Error("train_index.jsonの列車形式が不正です。");
    }
    keepKeys(train, [
      "service_uid",
      "train_no",
      "service_type",
      "train_name",
      "origin_station",
      "destination_station",
      "path_id",
      "stops",
    ]);
    for (const stop of train.stops) {
      if (stop === null || typeof stop !== "object") {
        throw new Error("train_index.jsonの停車形式が不正です。");
      }
      keepKeys(stop, [
        "station_name",
        "event",
        "time",
        "normalized_time",
        "route_meter",
        "route_time_minutes",
      ]);
    }
  }
  return source;
}

function keepKeys(value, keys) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      delete value[key];
    }
  }
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath || inputPath === outputPath) {
    throw new Error(
      "使い方: node tools/build_runtime_train_index.mjs INPUT OUTPUT",
    );
  }

  const source = JSON.parse(await readFile(inputPath, "utf8"));
  const compact = compactTrainIndex(source);
  await writeFile(outputPath, `${JSON.stringify(compact)}\n`, "utf8");
  process.stdout.write(
    `${compact.trains.length.toLocaleString("en-US")} trains written to ${outputPath}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
