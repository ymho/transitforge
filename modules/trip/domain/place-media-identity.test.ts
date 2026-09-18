import { describe, expect, it } from "vitest";
import { mergePlaceMedia, resolvePlaceMediaIdentity, type PlaceMedia } from "./place-media";
const place = (id: string, name = "倉敷美観地区", provider = "mapbox"): PlaceMedia => ({
  providerPlaceId:id,name,latitude:35,longitude:135,sourceUrl:'https://example.com',openingHoursStatus:'unknown',
  sources:[{provider,role:'identity',label:provider,url:'https://example.com'}],
});
describe('runtime identity proof',()=>{
  it('never resolves names, near coordinates or a district-named shop without binding',()=>{
    for(const p of [place('district'),place('shop','美観地区コンビニ'),place('distant','倉敷美観地区','wikipedia')]) {
      expect(resolvePlaceMediaIdentity(p).status).toBe('unresolved');
    }
  });
  it('requires exact provider identity and preserves parent/child distinction',()=>{
    const target={provider:'mapbox',providerPlaceId:'parent'};
    expect(resolvePlaceMediaIdentity(place('parent'),target).status).toBe('resolved');
    expect(resolvePlaceMediaIdentity(place('child'),target).status).toBe('mismatch');
    expect(resolvePlaceMediaIdentity(place('parent','同名','wikipedia'),target).status).toBe('unresolved');
  });
  it('dedups exact ID despite coordinate corrections, not across providers or parent IDs',()=>{
    expect(mergePlaceMedia([place('a'),{...place('a'),latitude:36},place('b'),place('a','同名','wikipedia')])).toHaveLength(3);
  });
  it('supports a restaurant itself when its stable ID is the selected target',()=>{
    expect(resolvePlaceMediaIdentity(place('restaurant','レストラン'),{provider:'mapbox',providerPlaceId:'restaurant'}).status).toBe('resolved');
  });
});
