import { describe, expect, it } from "vitest";
import { addressPrefecture, explicitlyOutsideServiceArea, prefectureStatus, serviceAreaPrefectures } from "./service-area";

describe("service area", () => {
  it("includes the agreed 32 prefectures and excludes the six Tohoku prefectures", () => {
    expect(new Set(serviceAreaPrefectures).size).toBe(32);
    for (const name of ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "山梨県", "沖縄県"]) expect(prefectureStatus(name)).toBe("outside");
    for (const name of ["東京都", "群馬県", "長野県", "島根県", "佐賀県", "鹿児島県", "JP-26"]) expect(prefectureStatus(name)).toBe("inside");
    expect(prefectureStatus("京都の近く")).toBe("unresolved");
  });
  it("uses an address prefix and never treats an attraction name as an address", () => {
    expect(addressPrefecture("日本 〒699-0701 島根県出雲市大社町杵築東195")).toBe("島根県");
    expect(addressPrefecture("京都府京都市下京区")).toBe("京都府");
    expect(addressPrefecture("青森県物産館 京都府の商品あり")).toBe("青森県");
    expect(addressPrefecture("京都府の歴史を学べる場所")).toBe("京都府");
    expect(addressPrefecture("京都の文化を紹介する青森県の施設")).toBeUndefined();
    expect(explicitlyOutsideServiceArea("宮城県仙台市")).toBe(true);
  });
});
