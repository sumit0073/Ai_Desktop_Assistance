/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly TAURI_ENV_PLATFORM?: "darwin" | "windows" | "linux" | string;
  readonly TAURI_ENV_DEBUG?: string;
  readonly TAURI_ENV_ARCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
