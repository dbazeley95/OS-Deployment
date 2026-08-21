/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_RELEASE_NOTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
