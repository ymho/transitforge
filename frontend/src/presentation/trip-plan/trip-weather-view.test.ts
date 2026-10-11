// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { tripWeatherFixture } from "../../../../modules/trip/domain/trip-weather.fixture";
import { renderTripWeather } from "./trip-weather-view";
import { tripWeatherBasis, tripWeatherTargets } from "@raiquora/trip/trip-weather";
it("renders saved day weather without source chrome and never labels failures as clear weather",()=>{
 const f=tripWeatherFixture(), text=renderTripWeather(f.trip,f.item)?.textContent;
 expect(text).toContain("雨 15〜22℃・降水80%"); expect(text).not.toContain("Open-Meteo"); expect(text).not.toContain("予報地点");
 const trip={...f.trip,weather:[{...f.weather,forecasts:[{target:f.weather.forecasts[0]!.target,status:"unavailable" as const,rows:[]}]}]};
 expect(renderTripWeather(trip,f.item)?.textContent).toContain("取得できません");
 expect(renderTripWeather({...f.trip,weather:undefined},f.item)).toBeUndefined();
});
it("shows both endpoints even when an overnight journey is rendered on the arrival day",()=>{
 const f=tripWeatherFixture(), item={id:"movement",type:"transport" as const,title:"移動",detail:{status:"selected" as const,mode:"walk" as const,origin:{name:"出発地",sources:[]},destination:{name:"到着地",sources:[]},provenance:{type:"manual" as const}},
 schedule:{type:"fixed" as const,startAt:{at:"2026-10-11T23:00:00+09:00",timeZone:"Asia/Tokyo"},endAt:{at:"2026-10-12T01:00:00+09:00",timeZone:"Asia/Tokyo"}}};
 const trip={...f.trip,items:[item]},targets=tripWeatherTargets(trip,item);
 const weather={...f.weather,itemId:item.id,basis:tripWeatherBasis(trip,item),forecasts:targets.map(target=>({target,status:"available" as const,locationName:target.place.name,timeZone:"Asia/Tokyo",rows:[{date:target.startDate,hour:target.at!.at.slice(11,13)+":00",weatherCode:0,temperatureCelsius:20,precipitationProbabilityPercent:10}]}))};
 const text=renderTripWeather({...trip,weather:[weather]},item,"2026-10-12")?.textContent;
 expect(text).toContain("出発 出発地 23:00");expect(text).toContain("到着 到着地 01:00");expect(text).not.toContain("取得できません");
});
