/**
 * 駅名を比較や索引に使える形へ正規化する。
 *
 * 表示用の表記は変更せず 比較時だけ全角半角 空白 末尾の「駅」と
 * 「ヶ」「ケ」の表記揺れを吸収する。
 */
export function normalizeStationName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s　]+/gu, "")
    .replace(/駅$/u, "")
    .replaceAll("ヶ", "ケ");
}

/** 駅名へ表示用の「駅」を重複させず付ける。 */
export function formatStationLabel(value: string): string {
  const stationName = value.normalize("NFKC").trim().replace(/駅$/u, "");
  return stationName ? `${stationName}駅` : "駅";
}
