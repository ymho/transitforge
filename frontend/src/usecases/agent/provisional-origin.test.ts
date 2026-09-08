import { describe, expect, it } from "vitest";
import type { Train } from "@raiquora/train/train";
import { provisionalOriginNotice, verifiedProvisionalOrigin } from "./provisional-origin";

const trains: Train[] = [{
  service_uid: "fixture", train_no: "1", train_name: "", service_type: "普通", path_id: "fixture",
  origin_station: "京都", destination_station: "大阪",
  stops: [{ station_name: "高槻", event: "着", route_time_minutes: 600 }],
}];

describe("verifiedProvisionalOrigin", () => {
  it.each(["京都", "大阪駅", "高槻"])("checks model-proposed %s against timetable stations", (name) => {
    expect(verifiedProvisionalOrigin(name, trains)).toBe(name.replace(/駅$/u, ""));
  });
  it.each(["未収録の駅", "大阪市", "", 12, "a".repeat(81)])("rejects unverified or malformed origins: %s", (name) => {
    expect(() => verifiedProvisionalOrigin(name, trains)).toThrow();
  });
  it("does not silently choose an origin without a model proposal", () => {
    expect(verifiedProvisionalOrigin(undefined, trains)).toBeUndefined();
  });
  it("distinguishes a provisional regional starting point from the user's home", () => {
    const notice = provisionalOriginNotice("大阪駅");
    expect(notice).toContain("大阪駅を起点にした仮案");
    expect(notice).toContain("ご自宅からこの駅までの移動は含みません");
    expect(notice).not.toContain("駅駅");
  });
});
