import { expect, it, vi } from "vitest";
import { tripWeatherFixture } from "../../../../modules/trip/domain/trip-weather.fixture.js";
import { TripApplication } from "./trip-application.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { TripSharingApplication } from "./trip-sharing-application.js";
import { DynamoDbTripSharing } from "../adapters/dynamodb-trip-sharing.js";
import { CryptographicShareSecret } from "../adapters/share-secret.js";
const owner = { subject: "owner-A" }, guest = { subject: "guest-B" };
function fixture() {
 const f=tripDynamoFixture(), saved=tripWeatherFixture(), crypto=new CryptographicShareSecret();
 const { weather: _weather, ...base } = saved.trip;
 const trip={ ...base, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z" };
 f.seed(trip, owner.subject);
 const repo=new DynamoDbTripSharing("test-trips",f.client,f.clock), sharing=new TripSharingApplication(f.repository,repo,crypto,repo,f.clock,{ facts: async()=>[] });
 const search=vi.fn(async()=>({ status: "unavailable" as const, freshness: "unknown" as const, evidence: [] }));
 const app=new TripApplication(f.repository,f.repository,f.clock,undefined,undefined,sharing,undefined,undefined,undefined,undefined,{search});
 const command={version:"trip-api-v1",operation:"refresh-weather",tripId:trip.id,itemId:"visit",baseRevision:0,mutationId:crypto.id()};
 return {...f,app,trip,search,sharing,command,crypto};
}
it("saves weather without changing planned items, read never refreshes, retry is idempotent and CAS rejects stale updates",async()=>{
 const f=fixture();
 const first=await f.app.execute(owner,f.command);
 expect(first).toMatchObject({trip:{revision:1,items:f.trip.items,weather:[{itemId:"visit"}]}});
 // Fixture clock is outside the forecast horizon: no external call is necessary.
 await f.app.execute(owner,{version:"trip-api-v1",operation:"get",tripId:f.trip.id}); expect(f.search).not.toHaveBeenCalled();
 expect(await f.app.execute(owner,f.command)).toEqual(first);
 await expect(f.app.execute(owner,{...f.command,mutationId:f.crypto.id()})).rejects.toMatchObject({code:"conflict"});
 await expect(f.app.execute(owner,{...f.command,baseRevision:1,itemId:"missing",mutationId:f.crypto.id()})).rejects.toMatchObject({code:"invalid-input"});
});
it.each(["editor","viewer"])("sharing %s sees stored forecasts and refresh requires write access",async role=>{
 const f=fixture();
 const grant=await f.sharing.execute(owner,{version:"trip-sharing-v1",operation:"create-grant",tripId:f.trip.id,role}) as {grant:{id:string};secret:string};
 await f.sharing.execute(guest,{version:"trip-sharing-v1",operation:"redeem",tripId:f.trip.id,grantId:grant.grant.id,secret:grant.secret});
 if(role==="viewer") await expect(f.app.execute(guest,f.command)).rejects.toMatchObject({code:"not-found"});
 else await f.app.execute(guest,f.command);
 await f.app.execute(owner,{...f.command,mutationId:f.crypto.id(),baseRevision:role==="editor"?1:0});
 expect(await f.app.execute(guest,{version:"trip-api-v1",operation:"get",tripId:f.trip.id})).toMatchObject({trip:{weather:[{itemId:"visit"}]}});
});
it("does not accept provider facts supplied by a public create request",async()=>{
 const f=fixture(), saved=tripWeatherFixture();
 await expect(f.app.execute(owner,{version:"trip-api-v1",operation:"create",trip:{...saved.trip,id:f.crypto.id()}})).rejects.toMatchObject({code:"invalid-input"});
});

it("limits even failed weather attempts to once per 24 hours across requests", async () => {
 const f = fixture(); let now = new Date("2026-10-10T01:00:00Z"); vi.spyOn(f.clock, "now").mockImplementation(() => now);
 const first = await f.app.execute(owner, f.command) as { trip: { weather: { checkedAt: string }[] } };
 expect(f.search).toHaveBeenCalledOnce(); expect(first.trip.weather[0]!.checkedAt).toBe(now.toISOString());
 now = new Date("2026-10-11T00:59:59Z");
 await f.app.execute(owner, { ...f.command, baseRevision: 1, mutationId: f.crypto.id() }); expect(f.search).toHaveBeenCalledOnce();
 now = new Date("2026-10-11T01:00:00Z");
 await f.app.execute(owner, { ...f.command, baseRevision: 2, mutationId: f.crypto.id() }); expect(f.search).toHaveBeenCalledTimes(2);
});
