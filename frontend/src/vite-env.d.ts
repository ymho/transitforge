/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
  readonly VITE_ACCOMMODATION_PROVIDER_DISPLAY_NAME?: string;
  readonly VITE_ACCOMMODATION_PROVIDER_CREDIT_URL?: string;
  readonly VITE_ACCOMMODATION_PROVIDER_CREDIT_IMAGE_URL?: string;
  readonly VITE_ACCOMMODATION_PROVIDER_CREDIT_ALT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
