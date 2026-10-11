import { expect, it } from "vitest";
import { decodePolyline, OtpGroundRouteProvider } from "./otp-ground-route-provider.js";
import type { GroundRouteCoverage } from "../ports/ground-route-provider.js";

const coverage: GroundRouteCoverage = { bounds: { south: 35.2, north: 35.8, west: 132.4, east: 133.2 },
  serviceStart: "2026-10-01", serviceEnd: "2026-12-31", feedUrl: "https://example.org/gtfs.zip",
  feedRetrievedAt: "2026-09-28T00:00:00Z", graphBuiltAt: "2026-09-28T01:00:00Z", attribution: "Example transit" };
const request = { origin: { name: "出発", latitude: 35.4, longitude: 132.7 },
  destination: { name: "目的地", latitude: 35.5, longitude: 132.8 }, departureAt: "2026-10-01T09:00:00+09:00", mode: "bus" as const };
const leg = (mode: string, start: string, end: string) => ({ mode, distance: 500,
  from: { name: "乗車" }, to: { name: "降車" }, route: { shortName: "一畑バス" },
  start: { scheduledTime: start }, end: { scheduledTime: end }, legGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } });

it("queries OTP with bus-only transit and walking transfers and decodes map geometry", async () => {
  let variables: Record<string, unknown> = {};
  const http = { fetch: async (_url: string, init?: RequestInit) => {
    variables = JSON.parse(String(init?.body)).variables;
    return new Response(JSON.stringify({ data: { planConnection: { edges: [{ node: { legs: [
      leg("WALK", "2026-10-01T09:00:00+09:00", "2026-10-01T09:10:00+09:00"),
      leg("BUS", "2026-10-01T09:15:00+09:00", "2026-10-01T09:30:00+09:00"),
    ] } }] } } }), { status: 200 });
  } };
  const result = await new OtpGroundRouteProvider("https://otp.example.org/otp/gtfs/v1", coverage, http, () => new Date("2026-09-28T02:00:00Z")).search(request);
  expect(variables).toMatchObject({ modes: { transitOnly: true, transit: { transit: [{ mode: "BUS" }], access: ["WALK"], egress: ["WALK"] } },
    dateTime: { earliestDeparture: request.departureAt } });
  expect(result).toMatchObject({ status: "available", routes: [{ durationMinutes: 30, legs: [{ mode: "walk" }, { mode: "bus", routeName: "一畑バス" }] }],
    coverage: { feedUrl: coverage.feedUrl } });
  expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

it("distinguishes coverage, empty results, malformed responses and walking outside GTFS dates", async () => {
  let calls = 0; let variables: Record<string, unknown> = {};
  const http = { fetch: async (_url: string, init?: RequestInit) => { calls++; variables = JSON.parse(String(init?.body)).variables;
    return new Response(JSON.stringify({ data: { planConnection: { edges: [] } } }), { status: 200 }); } };
  const provider = new OtpGroundRouteProvider("https://otp.example.org/otp/gtfs/v1", coverage, http);
  expect((await provider.search({ ...request, origin: { ...request.origin, longitude: 130 } })).status).toBe("outside_coverage");
  expect((await provider.search({ ...request, departureAt: "2027-01-01T09:00:00+09:00" })).status).toBe("outside_coverage");
  expect(calls).toBe(0);
  expect((await provider.search(request)).status).toBe("no_route");
  expect((await provider.search({ ...request, departureAt: "2027-01-01T09:00:00+09:00", mode: "walk" })).status).toBe("no_route");
  expect(variables).toMatchObject({ modes: { direct: ["WALK"], directOnly: true } });
  const invalid = new OtpGroundRouteProvider("https://otp.example.org/otp/gtfs/v1", coverage,
    { fetch: async () => new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), { status: 200 }) });
  expect((await invalid.search(request)).status).toBe("unavailable");
});

it("rejects plausible but non-bus and malformed geometry itineraries", async () => {
  const http = { fetch: async () => new Response(JSON.stringify({ data: { planConnection: { edges: [
    { node: { legs: [leg("WALK", "2026-10-01T09:00:00+09:00", "2026-10-01T09:10:00+09:00")] } },
  ] } } }), { status: 200 }) };
  const provider = new OtpGroundRouteProvider("https://otp.example.org/otp/gtfs/v1", coverage, http);
  expect((await provider.search(request)).status).toBe("unavailable");
  expect(decodePolyline("not-a-polyline!")).toEqual([]);
});

it("interprets OTP routing codes as no route or coverage limits without hiding unknown errors", async () => {
  const provider = (code: string) => new OtpGroundRouteProvider("https://otp.example.org/otp/gtfs/v1", coverage,
    { fetch: async () => new Response(JSON.stringify({ data: { planConnection: { edges: [], routingErrors: [{ code }] } } })) });
  expect((await provider("NO_TRANSIT_CONNECTION").search(request)).status).toBe("no_route");
  expect((await provider("NO_STOPS_IN_RANGE").search(request)).status).toBe("no_route");
  expect((await provider("OUTSIDE_SERVICE_PERIOD").search(request)).status).toBe("outside_coverage");
  expect((await provider("FUTURE_UNKNOWN_CODE").search(request)).status).toBe("unavailable");
});

it("does not promote the multi-feed envelope or another feed's dates to local coverage", async () => {
  let calls = 0;
  const http = { fetch: async () => { calls++; return new Response(JSON.stringify({ data: { planConnection: { edges: [] } } })); } };
  const local = { feedId: "local", bounds: { south: 35.3, north: 35.6, west: 132.6, east: 132.9 },
    serviceStart: "2026-10-01", serviceEnd: "2026-10-31", feedUrl: coverage.feedUrl, attribution: "local" };
  const provider = new OtpGroundRouteProvider("https://otp.example.org/otp/gtfs/v1", { ...coverage, feeds: [local,
    { ...local, feedId: "distant", bounds: { south: 35.6, north: 35.8, west: 133, east: 133.2 }, serviceEnd: "2026-12-31" },
  ] }, http);
  expect((await provider.search({ ...request, departureAt: "2026-11-01T09:00:00+09:00" })).status).toBe("outside_coverage");
  expect((await provider.search({ ...request, origin: { ...request.origin, longitude: 132.95 } })).status).toBe("outside_coverage");
  expect(calls).toBe(0);
  expect((await provider.search(request)).status).toBe("no_route");
  expect((await provider.search({ ...request, mode: "walk", departureAt: "2026-11-01T09:00:00+09:00" })).status).toBe("no_route");
});
