/** Search-provider metadata can reject obvious artwork, but cannot certify pixels as unedited. */
export interface PlacePhotoMetadata {
  title?: string;
  originalImageUrl?: string;
  width?: number;
  height?: number;
}

/** Applies to discovered sightseeing photos, not accommodation-provider inventory. */
export function isSuitablePlacePhoto(metadata: PlacePhotoMetadata): boolean {
  const fileName = imageFileName(metadata.originalImageUrl);
  const description = `${metadata.title ?? ""} ${fileName}`
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/gu, "$1 $2");
  // Do not reject ordinary article titles, signs in the scene, or routine photo correction.
  if (/(?:文字入[りれ]|テロップ|バナー|アイキャッチ|コラージュ|ポスター|チラシ|合成画像|イラスト|透かし入り)/u.test(description)) return false;
  if (/(?:^|[^a-z])(?:banner|poster|flyer|collage|infographic|illustration|watermarked|logo|screenshot|ogp|ogimage|eyecatch)(?:[^a-z]|$)/iu.test(description)) return false;
  if (/\b(?:text[\s_-]*overlay|with[\s_-]*text|social[\s_-]*card)\b/iu.test(description)) return false;
  if (/\.(?:svg|gif)(?:$)/iu.test(fileName)) return false;

  const { width, height } = metadata;
  if (typeof width === "number" && Number.isFinite(width) && width > 0 &&
      typeof height === "number" && Number.isFinite(height) && height > 0) {
    // Very wide/tall strips are frequently promotional artwork. Keep normal portrait photos.
    const ratio = width / height;
    if (ratio > 3 || ratio < 1 / 3) return false;
  }
  return true;
}

function imageFileName(value: string | undefined): string {
  if (!value) return "";
  try {
    const fileName = new URL(value).pathname.split("/").at(-1) ?? "";
    try { return decodeURIComponent(fileName); } catch { return fileName; }
  } catch {
    return "";
  }
}
