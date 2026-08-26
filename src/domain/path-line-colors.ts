import type { Train } from "@raiquora/train/train";

const neutralColor = "#a8aaad";

export function dominantLineColorsByPathId(
  trains: Array<Pick<Train, "path_id" | "service_uid">>,
  colorsByServiceUid: ReadonlyMap<string, string>,
): Map<string, string> {
  const countsByPathId = new Map<string, Map<string, number>>();

  for (const train of trains) {
    if (!train.path_id) {
      continue;
    }
    const color = colorsByServiceUid.get(train.service_uid) ?? neutralColor;
    const counts = countsByPathId.get(train.path_id) ?? new Map<string, number>();
    counts.set(color, (counts.get(color) ?? 0) + 1);
    countsByPathId.set(train.path_id, counts);
  }

  return new Map(
    [...countsByPathId].map(([pathId, counts]) => {
      const knownColors = [...counts].filter(([color]) => color !== neutralColor);
      const candidates = knownColors.length > 0 ? knownColors : [...counts];
      candidates.sort(
        ([leftColor, leftCount], [rightColor, rightCount]) =>
          rightCount - leftCount || leftColor.localeCompare(rightColor),
      );
      return [pathId, candidates[0]?.[0] ?? neutralColor];
    }),
  );
}
