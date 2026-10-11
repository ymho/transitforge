/** Product search boundary. This does not prove timetable or OTP coverage. */
export const serviceAreaPolicyVersion = "japan-32-prefectures-v1";
export const japanPrefectures = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] as const;
export const serviceAreaPrefectureCodes = [10, 11, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 46] as const;
export const serviceAreaPrefectures = serviceAreaPrefectureCodes.map(code => japanPrefectures[code - 1]!);
export type ServiceAreaStatus = "inside" | "outside" | "unresolved";

export function normalizePrefecture(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = value.normalize("NFKC").trim();
  if ((japanPrefectures as readonly string[]).includes(text)) return text;
  const code = /^JP-(\d{2})$/iu.exec(text);
  return code ? japanPrefectures[Number(code[1]) - 1] : undefined;
}
export function prefectureStatus(value: unknown): ServiceAreaStatus {
  const name = normalizePrefecture(value);
  return name ? (serviceAreaPrefectures as readonly string[]).includes(name) ? "inside" : "outside" : "unresolved";
}
/** Only a provider's address prefix is an address; arbitrary prose is not. */
export function addressPrefecture(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const address = value.normalize("NFKC").trim().replace(/^(?:日本[、,\s]*|〒?\d{3}-?\d{4}\s*)+/u, "");
  return japanPrefectures.find(name => address.startsWith(name));
}
export function explicitlyOutsideServiceArea(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return japanPrefectures.some(name => normalized.includes(name) && prefectureStatus(name) === "outside");
}
