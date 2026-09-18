// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureMapPlaceExplorer } from "./map-place-explorer";
import { mapPlaceCandidates, mapAccommodationCandidates } from "../../domain/map-travel-candidate";
import type { MapTravelCandidate } from "../../domain/map-travel-candidate";

beforeEach(() => vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function place(id: string): MapTravelCandidate {
  return mapPlaceCandidates([{ providerPlaceId: id, name: id, latitude: 35, longitude: 135,
    sourceUrl: "https://example.com", openingHoursStatus: "unknown" }])[0]!;
}
function setup(loadDetail = vi.fn(async (candidate: MapTravelCandidate) => candidate)) {
  const panel = document.createElement("section");
  const list = document.createElement("div");
  const close = document.createElement("button");
  const detail = document.createElement("section"); detail.hidden = true;
  const detailContent = document.createElement("div");
  const closeDetail = document.createElement("button");
  panel.append(list, close); detail.append(detailContent, closeDetail); document.body.append(panel, detail);
  const choose = vi.fn(); const focusPlace = vi.fn();
  const controller = configureMapPlaceExplorer({ panel, list, close, detail, detailContent, closeDetail, loadDetail, choose, focusPlace });
  return { controller, panel, detail, detailContent, closeDetail, loadDetail, choose, focusPlace };
}

describe("immediate shared place details", () => {
  it("refreshes list and detail from one snapshot, removing old images and separating sources", async () => {
    const old = place("A");
    old.imageUrl = "https://images.example/banner.jpg";
    old.summary = "古い要約";
    const fresh = mapPlaceCandidates([{ providerPlaceId: "A", name: "A", latitude: 35, longitude: 135,
      summary: "新しい要約", sourceUrl: "https://example.com/place", openingHoursStatus: "unknown",
      sources: [{ provider: "official", label: "地域案内", url: "https://example.com/guide?secret=private", role: "description" }], images: [] }])[0]!;
    const ui = setup(vi.fn(async () => fresh));
    ui.controller.show([old]); ui.controller.select("A"); await flush();
    expect(ui.panel.textContent).toContain("新しい要約");
    expect(ui.detailContent.textContent).toContain("新しい要約");
    expect(ui.panel.textContent).not.toContain("古い要約");
    expect(ui.panel.querySelector("img")).toBeNull();
    expect(ui.detailContent.querySelector("nav")?.textContent).toContain("解説: 地域案内");
    expect(ui.detailContent.innerHTML).not.toContain("secret=");
    expect(ui.panel.querySelector("[aria-current=true]")).not.toBeNull();
  });
  it("opens a landmark immediately and does not research again after results arrive", async () => {
    const ui = setup(); const request = deferred<readonly MapTravelCandidate[]>();
    const load = vi.fn(() => request.promise); const choose = vi.fn(); const onLoaded = vi.fn();
    ui.controller.showPending({ name: "地図の地点", choose, load, onLoaded });
    expect(ui.detail.hidden).toBe(false);
    expect(ui.detailContent.querySelector("h2")!.textContent).toBe("地図の地点");
    expect(ui.detailContent.textContent).not.toMatch(/調べています|確認できません/);
    ui.detailContent.querySelector("button")!.click();
    expect(choose).toHaveBeenCalledOnce();
    expect(ui.choose).not.toHaveBeenCalled();
    expect(ui.detail.getAttribute("aria-busy")).toBe("true");
    request.resolve([place("取得した地点")]); await flush();
    expect(load).toHaveBeenCalledOnce();
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(ui.loadDetail).not.toHaveBeenCalled();
    expect(ui.detailContent.querySelector("h2")!.textContent).toBe("取得した地点");
    expect(ui.detail.getAttribute("aria-busy")).toBe("false");
    ui.detailContent.querySelector("button")!.click();
    expect(ui.choose).toHaveBeenCalledWith(expect.objectContaining({ id: "取得した地点" }));
    ui.controller.select("取得した地点"); await flush();
    expect(ui.loadDetail).not.toHaveBeenCalled();
  });

  it("does not reopen a closed preview or apply its map results", async () => {
    const ui = setup(); const request = deferred<readonly MapTravelCandidate[]>(); const onLoaded = vi.fn();
    ui.controller.showPending({ name: "地点", choose: vi.fn(), load: () => request.promise, onLoaded });
    ui.closeDetail.click(); request.resolve([place("遅い結果")]); await flush();
    expect(ui.detail.hidden).toBe(true); expect(onLoaded).not.toHaveBeenCalled();
    expect(ui.detail.getAttribute("aria-busy")).toBe("false");
  });

  it("discards a previous landmark response when a new place is selected", async () => {
    const ui = setup(); const old = deferred<readonly MapTravelCandidate[]>(); const oldLoaded = vi.fn();
    ui.controller.showPending({ name: "古い地点", choose: vi.fn(), load: () => old.promise, onLoaded: oldLoaded });
    ui.controller.showPending({ name: "新しい地点", choose: vi.fn(), load: async () => [place("新しい地点")], onLoaded: vi.fn() });
    await flush(); old.resolve([place("古い地点")]); await flush();
    expect(ui.detailContent.querySelector("h2")!.textContent).toBe("新しい地点");
    expect(oldLoaded).not.toHaveBeenCalled();
  });

  it.each(["empty", "reject", "throw"])("keeps the selected place and action on %s", async (failure) => {
    const ui = setup();
    ui.controller.showPending({ name: "選択した地点", choose: vi.fn(), onLoaded: vi.fn(), load: () => {
      if (failure === "throw") throw new Error("offline");
      return failure === "reject" ? Promise.reject(new Error("offline")) : Promise.resolve([]);
    } });
    await flush();
    expect(ui.detail.hidden).toBe(false);
    expect(ui.detailContent.textContent).toContain("選択した地点");
    expect(ui.detailContent.textContent).toContain("確認できませんでした");
    expect(ui.detailContent.textContent).not.toContain("調べています");
    expect(ui.detail.getAttribute("aria-busy")).toBe("false");
  });

  it("shares in-flight research and reuses a completed result within the selection", async () => {
    const request = deferred<MapTravelCandidate>(); const load = vi.fn(() => request.promise); const ui = setup(load);
    ui.controller.show([place("A")]); ui.controller.select("A"); ui.controller.select("A");
    expect(load).toHaveBeenCalledOnce();
    request.resolve(place("A")); await flush();
    ui.controller.select("A"); expect(load).toHaveBeenCalledOnce();
    expect(ui.detail.getAttribute("aria-busy")).toBe("false");
  });

  it("does not replace a hotel with a stale place result", async () => {
    const request = deferred<MapTravelCandidate>(); const ui = setup(vi.fn(() => request.promise));
    const hotel = mapAccommodationCandidates([{ providerItemId: "hotel", name: "宿", latitude: 35, longitude: 135,
      checkInDate: "2026-09-12", checkOutDate: "2026-09-13" }])[0]!;
    ui.controller.show([place("A"), hotel]); ui.controller.select("A"); ui.controller.select(hotel.id);
    request.resolve(place("A")); await flush();
    expect(ui.detailContent.querySelector("h2")!.textContent).toBe("宿");
    expect(ui.detail.getAttribute("aria-busy")).toBe("false");
  });

  it("retains a candidate on rejected enrichment without unhandled errors", async () => {
    const ui = setup(vi.fn(async () => { throw new Error("offline"); }));
    ui.controller.show([place("A")]); ui.controller.select("A"); await flush();
    expect(ui.detailContent.querySelector("h2")!.textContent).toBe("A");
    expect(ui.detail.getAttribute("aria-busy")).toBe("false");
  });
});
