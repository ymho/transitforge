/** Brand imagery only: never treated as a photo of an adopted destination or accommodation. */
const covers = ["/media/home-setouchi-v2.webp", "/media/home-kinosaki-v2.webp", "/media/home-izumo-v2.webp"] as const;
export function tripCoverImage(id: string): string {
  const index = [...id].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % covers.length;
  return covers[index]!;
}
