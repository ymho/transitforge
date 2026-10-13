/** Brand imagery only: never treated as a photo of an adopted destination or accommodation. */
export const brandTravelImages = [
  ["/media/home-setouchi-v2.webp", 1672, 941, "海辺のまちと島々"],
  ["/media/home-kinosaki-v2.webp", 1942, 809, "夕暮れの温泉街"],
  ["/media/home-izumo-v2.webp", 1774, 887, "木立に包まれた参道"],
  ["/media/home-autumn.webp", 1200, 800, "紅葉に彩られた小道"],
  ["/media/home-coastal-train.webp", 1200, 800, "海岸沿いを走る列車"],
  ["/media/home-highland.webp", 1200, 800, "山々に囲まれた湖"],
  ["/media/home-harbor-night.webp", 1200, 800, "灯りが映る夜の港町"],
  ["/media/home-cafe.webp", 1200, 800, "窓辺で楽しむコーヒー"],
  ["/media/home-snow.webp", 1200, 800, "雪に包まれた山あいの街"],
] as const;
export function tripCoverImage(id: string): string {
  const index = [...id].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % brandTravelImages.length;
  return brandTravelImages[index]![0];
}
