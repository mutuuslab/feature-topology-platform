// 기준 패키지(FP-DETAILED-1.1)의 정적 자산은 public/spec 아래에 있고,
// 배포는 저장소 하위 경로(/feature-topology-platform/)에 놓일 수 있으므로
// 모든 URL은 Vite 기준 경로(BASE_URL)를 거쳐 만든다.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

export function specAsset(rel: string): string {
  return `${BASE}/spec/${String(rel).replace(/^\/+/, '')}`;
}

export const SPEC_DATA_DIR = 'data';
export const SPEC_SCREEN_SVG_DIR = 'screens';
export const SPEC_ARCH_SVG_DIR = 'arch';
export const SPEC_AAOS_SVG_DIR = 'aaos';

export function specDataUrl(fileName: string): string {
  return specAsset(`${SPEC_DATA_DIR}/${fileName}`);
}

// 상세 영역 첫 화면 SVG의 파일명 규칙. 파일명은 파일명 목록(assets.json)을 우선 사용하고,
// 목록을 아직 읽지 못한 경우에만 이 규칙으로 추정한다.
export const SCREEN_SVG_SUFFIX = '_First_Screen_v1_1.svg';

export function screenSvgUrl(areaId: string, manifest?: string[]): string {
  const known = manifest && manifest.find((f) => f.startsWith(`${areaId}_`));
  return specAsset(`${SPEC_SCREEN_SVG_DIR}/${known || `${areaId}${SCREEN_SVG_SUFFIX}`}`);
}

export function archSvgUrl(fileName: string): string {
  return specAsset(`${SPEC_ARCH_SVG_DIR}/${fileName}`);
}

export function aaosSvgUrl(fileName: string): string {
  return specAsset(`${SPEC_AAOS_SVG_DIR}/${fileName}`);
}
