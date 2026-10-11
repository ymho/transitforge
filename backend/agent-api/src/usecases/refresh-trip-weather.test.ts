import { expect, it, vi } from "vitest";
import { tripWeatherFixture } from "../../../../modules/trip/domain/trip-weather.fixture.js";
import { refreshTripWeather } from "./refresh-trip-weather.js";
import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import { selectedTripItemSnapshot, createAgentContextSnapshot } from "@raiquora/agent/agent-context-snapshot";
const now = new Date("2026-10-10T01:00:00Z");
const evidence = [{ id: "fixture-weather", kind: "weather" as const, provider: "open-meteo", sourceId: "fixture", retrievedAt: now.toISOString(), validUntil: "2026-10-10T02:00:00Z", confidence: "provider-forecast" as const }];
function provider() { return { search: vi.fn(async (_query: import("@raiquora/trip/weather-forecast").WeatherForecastQuery) => availableExternalInformation({ locationName: "公園", latitude: 35, longitude: 135, timezone: "Asia/Tokyo", alertsAvailable: false,
 hourly: [{ time: "2026-10-11T10:00", temperatureCelsius: 20, precipitationProbabilityPercent: 30, precipitationMillimeters: 0, weatherCode: 2 }],
 daily: [{ date: "2026-10-11", minimumTemperatureCelsius: 15, maximumTemperatureCelsius: 22, maximumPrecipitationProbabilityPercent: 80, precipitationMillimeters: 2, weatherCode: 61 }] }, evidence, now)) }; }
it("retains daily forecast and source/freshness, and exposes the same saved facts to AI", async () => {
 const f = tripWeatherFixture(), p = provider(); const weather = await refreshTripWeather(f.trip, f.item, p, now);
 expect(p.search).toHaveBeenCalledWith(expect.objectContaining({ coordinate: { latitude: 35, longitude: 135 }, startDate: "2026-10-11" }));
 expect(weather.forecasts[0]).toMatchObject({ status: "available", rows: [{ date: "2026-10-11", minimumTemperatureCelsius: 15, precipitationProbabilityPercent: 80 }] });
 const trip = { ...f.trip, weather: [weather] };
 expect(selectedTripItemSnapshot(f.item, trip)).toMatchObject({ weather, weatherSemantics: "saved-forecast-not-current-conditions-check-validUntil" });
 expect(createAgentContextSnapshot(undefined, trip).trip?.schedule[0]?.weather).toEqual(weather);
});
it("uses the local hour at a fixed instant; never converts a daily forecast into hourly weather", async () => {
 const f=tripWeatherFixture(), p=provider(), item={ ...f.item, schedule: { type: "fixed" as const, startAt: { at: "2026-10-11T10:45:00+09:00", timeZone: "Asia/Tokyo" } } };
 const weather=await refreshTripWeather(f.trip,item,p,now);
 expect(weather.forecasts[0]?.rows).toEqual([{ date: "2026-10-11", hour: "10:00", weatherCode: 2, temperatureCelsius: 20, precipitationProbabilityPercent: 30 }]);
 p.search.mockResolvedValueOnce(availableExternalInformation({ locationName: "公園", latitude: 35, longitude: 135, timezone: "Asia/Tokyo", alertsAvailable: false, hourly: [], daily: [] }, evidence, now));
 expect((await refreshTripWeather(f.trip,item,p,now)).forecasts[0]?.status).toBe("unavailable");
});
it("avoids provider calls outside the horizon and does not fabricate weather after a failure", async () => {
 const f=tripWeatherFixture(), p=provider();
 expect((await refreshTripWeather(f.trip,{ ...f.item, schedule: { type: "day", date: "2027-01-01" } },p,now)).forecasts[0]?.status).toBe("outside-forecast"); expect(p.search).not.toHaveBeenCalled();
 p.search.mockRejectedValueOnce(new Error("offline"));
 expect((await refreshTripWeather(f.trip,f.item,p,now)).forecasts[0]).toMatchObject({ status: "unavailable", rows: [] });
});
it("resolves railway endpoints from unique catalog coordinates and refuses ambiguous same-name stations", async()=>{
 const {railSelectionFixture}=await import("../../../../modules/trip/domain/selected-rail-journey.fixture.js");
 const {selectRailJourney,projectRailSchedule}=await import("@raiquora/trip/selected-rail-journey");
 const f=railSelectionFixture(),journey=selectRailJourney(f.candidate,f.inputs,f.selectedAt),base=tripWeatherFixture();
 const item={id:"rail",type:"transport" as const,title:"移動",detail:{status:"selected" as const,mode:"rail" as const,journey},schedule:projectRailSchedule(journey)};
 const p=provider(), load=vi.fn(async()=>({schema_version:"station-line-catalog-v1" as const,source:"fixture",lines:[{operator:"fixture",line:"fixture",stations:[
 {name:journey.legs[0]!.origin.name,coordinate:[135,35] as [number,number]}, {name:journey.legs.at(-1)!.destination.name,coordinate:[136,36] as [number,number]}]}]}));
 await refreshTripWeather(base.trip,item,p,new Date(f.selectedAt),{load});
 expect(p.search).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledOnce();
 expect(p.search.mock.calls[0]![0]).toMatchObject({coordinate:{longitude:135,latitude:35}});
 load.mockResolvedValueOnce({schema_version:"station-line-catalog-v1",source:"fixture",lines:[{operator:"fixture",line:"fixture",stations:[{name:journey.legs[0]!.origin.name,coordinate:[135,35]},{name:journey.legs[0]!.origin.name,coordinate:[140,40]}]}]});
 p.search.mockClear(); expect((await refreshTripWeather(base.trip,item,p,new Date(f.selectedAt),{load})).forecasts.every(f=>f.status==="unavailable")).toBe(true); expect(p.search).not.toHaveBeenCalled();
});
it("keeps the original observation time and expiry when a provider cache is reused", async()=>{
 const f=tripWeatherFixture(), p=provider();
 const weather=await refreshTripWeather(f.trip,f.item,p,new Date("2026-10-10T01:30:00Z"));
 expect(weather.fetchedAt).toBe(now.toISOString()); expect(weather.validUntil).toBe("2026-10-10T02:00:00Z");
});
it("accepts observations recorded during the provider request but rejects future timestamps", async()=>{
 const f=tripWeatherFixture(), p=provider(), observedAt=new Date(now.getTime()+250), receivedAt=new Date(now.getTime()+500);
 const response=await p.search({location:"公園"});
 p.search.mockResolvedValue({...response,evidence:[{...evidence[0]!,retrievedAt:observedAt.toISOString()}]});
 const weather=await refreshTripWeather(f.trip,f.item,p,now,undefined,()=>receivedAt);
 expect(weather.forecasts[0]?.status).toBe("available"); expect(weather.fetchedAt).toBe(observedAt.toISOString());
 p.search.mockResolvedValue({...response,evidence:[{...evidence[0]!,retrievedAt:new Date(receivedAt.getTime()+1).toISOString()}]});
 expect((await refreshTripWeather(f.trip,f.item,p,now,undefined,()=>receivedAt)).forecasts[0]?.status).toBe("unavailable");
});
