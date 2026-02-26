/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTHENTIK_URL: string;
  readonly VITE_AUTHENTIK_CLIENT_ID: string;
  readonly VITE_DIRECTUS_URL: string;
  readonly VITE_RESTREAMER_URL: string;
  readonly VITE_AMPACHE_URL: string;
  readonly VITE_CALCOM_URL: string;
  readonly VITE_ELEMENT_URL: string;
  readonly VITE_BLUESKY_URL: string;
  readonly VITE_APP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
