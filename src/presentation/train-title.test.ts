import { describe, expect, it } from "vitest";

import { trainServiceLabelFor, trainTitleFor } from "./train-title";

describe("train detail title", () => {
  it("shows the service type and destination for an ordinary service", () => {
    expect(
      trainTitleFor({
        service_type: "新快速",
        train_name: "",
        destination_station: "姫路",
      }),
    ).toEqual({
      main: "新快速 姫路",
      suffix: "行き",
    });
  });

  it("shows a named limited express with a separated service number", () => {
    expect(
      trainTitleFor({
        service_type: "特急",
        train_name: "はるか16号",
        destination_station: "京都",
      }),
    ).toEqual({
      main: "特急 はるか 16号",
    });
  });

  it("uses the Shinkansen service name instead of the generic type", () => {
    const train = {
      service_type: "新幹線",
      train_name: "のぞみ",
      destination_station: "博多",
    };

    expect(trainTitleFor(train)).toEqual({
      main: "のぞみ 博多",
      suffix: "行き",
    });
    expect(trainServiceLabelFor(train)).toBe("のぞみ");
  });
});
