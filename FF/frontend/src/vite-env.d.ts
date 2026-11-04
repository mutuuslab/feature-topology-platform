/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1'이면 Windows 데스크톱(Tauri) 배포본 빌드 */
  readonly VITE_FF_DESKTOP?: string;
}
