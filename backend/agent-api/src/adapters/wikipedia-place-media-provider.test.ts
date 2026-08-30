import { describe, expect, it, vi } from "vitest";
import { WikipediaPlaceMediaProvider } from "./wikipedia-place-media-provider.js";

describe("WikipediaPlaceMediaProvider", () => {
  it("keeps image attribution and place coordinates", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{ pageid: 1, title: "出雲大社", fullurl: "https://ja.wikipedia.org/wiki/x", extract: "神社", coordinates: [{ lat: 35.4, lon: 132.7 }], pageimage: "Izumo.jpg", thumbnail: { source: "https://upload.wikimedia.org/thumb.jpg", width: 640, height: 400 } }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{ title: "File:Izumo.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/640.jpg", thumbwidth: 640, thumbheight: 400, descriptionurl: "https://commons.wikimedia.org/wiki/File:Izumo.jpg", extmetadata: { Artist: { value: "作者" }, LicenseShortName: { value: "CC BY-SA 4.0" }, Credit: { value: "Wikimedia Commons" } } }] }] } }), { status: 200 }));
    const provider = new WikipediaPlaceMediaProvider({ fetch }, () => new Date("2026-08-27T00:00:00Z"));
    const result = await provider.search({ query: "出雲", limit: 3 });
    expect(result.data?.places[0]).toEqual(expect.objectContaining({ name: "出雲大社", latitude: 35.4, image: expect.objectContaining({ license: "CC BY-SA 4.0", attribution: expect.stringContaining("作者") }) }));
  });

  it("loads a licensed image gallery only for an explicit detail request", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{
        pageid: 1, title: "日御碕灯台", fullurl: "https://ja.wikipedia.org/wiki/lighthouse",
        extract: "石造灯台", coordinates: [{ lat: 35.4, lon: 132.6 }], pageimage: "Main.jpg",
      }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{
        title: "File:Main.jpg", imageinfo: [{
          thumburl: "https://upload.wikimedia.org/main.jpg", mime: "image/jpeg",
          extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } },
        }],
      }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{
        title: "File:View.jpg", imageinfo: [{
          thumburl: "https://upload.wikimedia.org/view.jpg", mime: "image/jpeg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:View.jpg",
          extmetadata: { Artist: { value: "撮影者" }, LicenseShortName: { value: "CC BY 4.0" } },
        }],
      }, {
        title: "File:Document.pdf", imageinfo: [{
          thumburl: "https://upload.wikimedia.org/document.jpg", mime: "application/pdf",
          extmetadata: {},
        }],
      }] } }), { status: 200 }));
    const provider = new WikipediaPlaceMediaProvider({ fetch });

    const result = await provider.search({ query: "日御碕灯台", limit: 1, detail: true });

    expect(result.data?.places[0]?.images?.map(({ url }) => url)).toEqual([
      "https://upload.wikimedia.org/main.jpg",
      "https://upload.wikimedia.org/view.jpg",
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
