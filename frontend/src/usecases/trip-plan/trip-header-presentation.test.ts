import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { tripDateLabel } from "./trip-header-presentation";
const trip = (start: string, end?: string) => createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-01-01T00:00:00Z", [{ id: "stay", title: "宿", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: start, ...(end ? { endDate: end } : {}) } }]);
it("shows both months, night/day counts, cross-year dates and undated trips", () => {
  expect(tripDateLabel(trip("2026-10-05", "2026-10-06"))).toBe("10月5日ー10月6日・1泊2日");
  expect(tripDateLabel(trip("2026-10-05"))).toBe("10月5日・日帰り");
  expect(tripDateLabel(trip("2026-12-31", "2027-01-01"))).toBe("2026年12月31日ー2027年1月1日・1泊2日");
  expect(tripDateLabel(createTrip(trip("2026-10-05").id, "旅", "2026-01-01T00:00:00Z"))).toBe("日程未定");
});
