export interface AccommodationProviderAttribution {
  displayName: string;
  creditUrl: string;
  creditImageUrl: string;
  creditAlt: string;
}

export interface AccommodationProviderAttributionEnvironment {
  VITE_ACCOMMODATION_PROVIDER_DISPLAY_NAME?: string;
  VITE_ACCOMMODATION_PROVIDER_CREDIT_URL?: string;
  VITE_ACCOMMODATION_PROVIDER_CREDIT_IMAGE_URL?: string;
  VITE_ACCOMMODATION_PROVIDER_CREDIT_ALT?: string;
}

export function accommodationProviderAttributionFromEnvironment(
  environment: AccommodationProviderAttributionEnvironment,
): AccommodationProviderAttribution | null {
  const displayName = normalized(environment.VITE_ACCOMMODATION_PROVIDER_DISPLAY_NAME);
  const creditUrl = normalized(environment.VITE_ACCOMMODATION_PROVIDER_CREDIT_URL);
  const creditImageUrl = normalized(environment.VITE_ACCOMMODATION_PROVIDER_CREDIT_IMAGE_URL);
  const creditAlt = normalized(environment.VITE_ACCOMMODATION_PROVIDER_CREDIT_ALT);

  if (!displayName || !creditUrl || !creditImageUrl || !creditAlt) return null;
  return { displayName, creditUrl, creditImageUrl, creditAlt };
}

function normalized(value: string | undefined): string {
  return value?.trim() ?? "";
}
