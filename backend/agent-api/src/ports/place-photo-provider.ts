import type { PlaceMedia } from "@raiquora/trip/place-media";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
/** Discovery photos illustrate a requested place. They never establish POI
 * identity, coordinates, hours, or descriptive facts. */
export interface PlacePhotoProvider {
  searchPhotos(place: PlaceMedia): Promise<ExternalTravelInformation<{ images: NonNullable<PlaceMedia["images"]> }>>;
}
