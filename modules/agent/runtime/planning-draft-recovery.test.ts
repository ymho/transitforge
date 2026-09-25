import { expect, it } from "vitest";
import type { Evidence } from "./evidence-model";
import { recoverPlanningDraft } from "./planning-draft-recovery";

const source: Evidence = { id: "page-izumo", category: "external", knowledgeKind: "deterministic_fact", subject: "出雲大社",
  facts: { status: "available", freshness: "fresh", sourcePrecision: "read-page", sourceUrl: "https://izumo.example/guide",
    sourceTitle: "出雲大社|出雲観光ガイド", sourceExcerpt: "出雲大社は歴史ある神社です。 神門通りでは町歩きを楽しめます。神々が集う神在祭も紹介しています。" },
  references: [{ sourceType: "external-source", sourceRef: "https://izumo.example/guide", retrievedAt: "2026-09-25T00:00:00Z",
    freshness: "current", summary: "確認済みページ" }] };
const photo: Evidence = { ...source, id: "photo-izumo", facts: { ...source.facts,
  imageUrl: "https://images.example/izumo.jpg", imageSourceUrl: "https://photos.example/izumo",
  imageAttribution: "Example", boundSourceUrls: ["https://izumo.example/guide"] } };

it("returns a validated day-one itinerary with a source-bound photo and unknown cost", () => {
  const result = recoverPlanningDraft([source, photo], "出雲大社に行きたい")!;
  expect(result.publicPlanPresentation?.candidates).toHaveLength(1);
  expect(result.publicPlanPresentation?.candidates[0]?.days[0]?.label).toBe("1日目");
  expect(result.publicPlanPresentation?.candidates[0]?.cost).toEqual({ status: "unknown" });
  expect(result.publicPlanPresentation?.photoRefs).toEqual([photo.id]);
  expect(result.text).toContain("現地で過ごす1日目の仮案");
  expect(result.text).not.toContain("出雲大社をゆっくり訪ねる");
  expect(result.text).toContain('[出典 ↗](https://izumo.example/guide "参考資料")');
  expect(result.text).toContain("![出雲大社]");
  expect(result.text).toContain('"Raiquora verified photo"');
  expect(result.text).not.toContain("確認できた資料から場所の候補を紹介します");
  expect(result.text).not.toContain("神門通りでは町歩きを楽しめます。神々が集う神在祭も紹介しています。");
});

it("does not attach unrelated photos, search snippets, or navigation-only pages", () => {
  const unrelatedPhoto = { ...photo, facts: { ...photo.facts, boundSourceUrls: ["https://different.example/guide"] } };
  const result = recoverPlanningDraft([source, unrelatedPhoto], "出雲大社に行きたい")!;
  expect(result.publicPlanPresentation?.photoRefs).toEqual([]);
  expect(recoverPlanningDraft([{ ...source, knowledgeKind: "unverified_information", facts: { ...source.facts, sourcePrecision: "search-snippet" } }], "出雲大社に行きたい")).toBeUndefined();
  expect(recoverPlanningDraft([{ ...source, facts: { ...source.facts, sourceExcerpt: "menu\nホーム\nお問い合わせ" } }], "出雲大社に行きたい")).toBeUndefined();
});
