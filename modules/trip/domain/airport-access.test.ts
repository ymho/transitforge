import { describe, expect, it } from "vitest";
import { airportRailAccess } from "./airport-access";
describe("airportRailAccess", () => { it("connects a flight airport to the deterministic rail tool input", () => { expect(airportRailAccess("kix")?.stationName).toBe("関西空港"); }); });
