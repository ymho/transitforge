/**
 * This provider resolves city-level forecasts, not municipal wards or POIs.
 * Accept the common city+ward notation without requiring a model/user to emit
 * one exact spelling. This does not infer a municipality from a facility name.
 */
export function weatherGeocodingLocation(value: string): string {
  const location = value.normalize("NFKC").trim();
  const cityAndWard = /^(.+市)[^\d\s市]+区$/u.exec(location);
  return cityAndWard?.[1] ?? location;
}
