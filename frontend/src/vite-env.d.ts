/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BACKEND?: string;
  readonly FRONTEND?: string;
  readonly BACKEND_URL?: string;
  readonly FRONTEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
