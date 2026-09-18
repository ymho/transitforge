import { describe, expect, it } from "vitest";
import { isSuitablePlacePhoto } from "./place-photo-selection.js";

describe("isSuitablePlacePhoto", () => {
  it.each([
    "出雲の文字入り写真", "文字入れ画像", "観光バナー", "旅のアイキャッチ", "写真コラージュ",
    "イベントポスター", "紹介チラシ", "合成画像", "灯台のイラスト", "透かし入り写真",
    "Travel banner", "Photo collage", "Watermarked photo", "Text overlay", "Photo with text",
  ])("加工・文字入れの手掛かりを除外する: %s", (title) => {
    expect(isSuitablePlacePhoto({ title })).toBe(false);
  });

  it.each(["ogp.jpg", "mainBanner01.png", "social-card.webp", "文字入り.jpg", "logo.svg", "animated.gif"])(
    "元画像のファイル名を検査する: %s", (name) => {
      expect(isSuitablePlacePhoto({ originalImageUrl: `https://photos.example/${encodeURIComponent(name)}?size=640` })).toBe(false);
    },
  );

  it.each([[1200, 300], [300, 1200]])("極端に細長い画像を除外する: %s x %s", (width, height) => {
    expect(isSuitablePlacePhoto({ width, height })).toBe(false);
  });

  it.each([
    "出雲大社の看板と鳥居", "おすすめ観光スポット10選", "温泉の公式サイト", "明るさ補正済みの風景",
    "Panorama of the coast", "Bannerman Castle", "夕景の写真",
  ])("実物の文字や一般的な紹介記事だけでは除外しない: %s", (title) => {
    expect(isSuitablePlacePhoto({ title, width: 800, height: 1200 })).toBe(true);
  });

  it("メタデータ不足・不正URLでも例外にせず、文字なしを保証しない", () => {
    expect(isSuitablePlacePhoto({})).toBe(true);
    expect(isSuitablePlacePhoto({ originalImageUrl: "invalid", width: NaN, height: 0 })).toBe(true);
    expect(isSuitablePlacePhoto({ originalImageUrl: "https://photos.example/%ZZ.jpg" })).toBe(true);
    expect(isSuitablePlacePhoto({ originalImageUrl: "https://photos.example/posters/photo.jpg" })).toBe(false);
  });

  it.each(["banners", "promoPoster", "social_card", "photo-collage", "%E3%83%90%E3%83%8A%E3%83%BC"])("checks parent path %s", (path) => {
    expect(isSuitablePlacePhoto({ originalImageUrl: `https://images.example/${path}/photo.jpg` })).toBe(false);
  });

  it("does not inspect unrelated host/query metadata", () => {
    expect(isSuitablePlacePhoto({ title: "Museum architecture", originalImageUrl: "https://poster.example/architecture/photo.jpg?article=poster" })).toBe(true);
  });
});
