import { describe, expect, it } from "vitest";
import { mergePlaceMedia, resolvePlaceTargetBinding, samePlaceSourcePage, type PlaceMedia } from "./place-media";
const place = (id: string, name = "倉敷美観地区", provider = "mapbox"): PlaceMedia => ({
  providerPlaceId:id,name,latitude:35,longitude:135,sourceUrl:'https://example.com',openingHoursStatus:'unknown',
  sources:[{provider,role:'identity',label:provider,url:'https://example.com'}],
});
describe('runtime identity proof',()=>{
  it('accepts only an exact facility source page, not host/proximity/name hints',()=>{
    expect(samePlaceSourcePage('https://example.com/place/a','https://example.com/place/a')).toBe(true);
    for(const other of ['https://example.com/place/b','https://example.com/place/a?q=a','http://example.com/place/a']) {
      expect(samePlaceSourcePage('https://example.com/place/a',other)).toBe(false);
    }
    expect(samePlaceSourcePage('https://example.com/','https://example.com/')).toBe(false);
  });
  it('never resolves names, near coordinates or a district-named shop without binding',()=>{
    for(const p of [place('district'),place('shop','美観地区コンビニ'),place('distant','倉敷美観地区','wikipedia')]) {
      expect(resolvePlaceTargetBinding(p).status).toBe('unresolved');
    }
  });
  it('requires exact provider identity and preserves parent/child distinction',()=>{
    const target={provider:'mapbox',providerPlaceId:'parent'};
    expect(resolvePlaceTargetBinding(place('parent'),target).status).toBe('resolved');
    expect(resolvePlaceTargetBinding(place('child'),target).status).toBe('mismatch');
    expect(resolvePlaceTargetBinding(place('parent','同名','wikipedia'),target).status).toBe('unresolved');
  });
  it('dedups exact ID despite coordinate corrections, not across providers or parent IDs',()=>{
    expect(mergePlaceMedia([place('a'),{...place('a'),latitude:36},place('b'),place('a','同名','wikipedia')])).toHaveLength(3);
  });
  it('supports a restaurant itself when its stable ID is the selected target',()=>{
    expect(resolvePlaceTargetBinding(place('restaurant','レストラン'),{provider:'mapbox',providerPlaceId:'restaurant'}).status).toBe('resolved');
  });
});
