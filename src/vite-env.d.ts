/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_TOKEN: string
  readonly VITE_LENS_ID: string
  readonly VITE_LENS_GROUP_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
