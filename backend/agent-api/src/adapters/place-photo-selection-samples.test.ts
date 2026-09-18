import { describe, expect, it } from "vitest";
import { isSuitablePlacePhoto } from "./place-photo-selection.js";

// Public metadata only; pixels were manually inspected on 2026-09-18, not redistributed.
const samples = [
  { title: "風景 朝", originalImageUrl: "https://www.skybldg.co.jp/observatory/img/i_observatory_slide01.jpg",
    width: 1400, height: 640, editedText: false, admitted: true },
  { title: "第4回　にっぽん青果祭", originalImageUrl: "https://www.skybldg.co.jp/event/img/2026/event_seika_0918.webp",
    width: 880, height: 540, editedText: true, admitted: true },
  { title: "ホットペッパーグルメ Webサービス", originalImageUrl: "https://webservice.recruit.co.jp/banner/hotpepper-s.gif",
    width: 135, height: 17, editedText: true, admitted: false },
];

describe("small real-metadata photo sample (not a population accuracy estimate)", () => {
  it.each(samples)("records selector outcome for $title", sample => {
    expect(isSuitablePlacePhoto(sample)).toBe(sample.admitted);
  });
  it("retains the documented metadata blind spot, without claiming pixel detection", () => {
    expect(samples.filter(s => s.editedText && isSuitablePlacePhoto(s))).toHaveLength(1);
    expect(samples.filter(s => !s.editedText && !isSuitablePlacePhoto(s))).toHaveLength(0);
  });
});
