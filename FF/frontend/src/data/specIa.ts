// 기준 패키지(FP-DETAILED-1.1 / MENU 1.3)의 화면·속성·명령 데이터 로더.
// 큰 JSON은 번들에 넣지 않고 public/spec/data 에서 필요할 때 읽고 캐시한다.
// 네비게이션·역할·규칙처럼 항상 필요한 요약 값은 specNav.ts(생성물, eager)에 있다.
import type {
  SpecCommandExample,
  SpecFriField,
  SpecFriGroup,
  SpecOpaField,
  SpecOpaObject,
  SpecScreenDetail,
  SpecUnleashItem,
} from './specTypes';
import { specDataUrl, screenSvgUrl } from './specAssets';

export interface SpecFieldDictionary {
  /** FRI-001~184 + OPA-001~249 (433). FRI 항목만 group을 갖는다. */
  fri: SpecFriField[];
  /** OPA-001~249 만 추린 목록. */
  opa: SpecOpaField[];
  groups: SpecFriGroup[];
  objects: SpecOpaObject[];
}

export interface SpecAssetManifest {
  screens: string[];
  arch: string[];
  aaos: string[];
}

const pending = new Map<string, Promise<unknown>>();

function fetchJson<T>(fileName: string): Promise<T> {
  const hit = pending.get(fileName);
  if (hit) return hit as Promise<T>;
  const p = fetch(specDataUrl(fileName)).then((res) => {
    if (!res.ok) throw new Error(`기준 데이터를 읽지 못했습니다 (${fileName} · HTTP ${res.status})`);
    return res.json() as Promise<T>;
  });
  pending.set(fileName, p);
  p.catch(() => pending.delete(fileName));
  return p as Promise<T>;
}

export function loadScreenDetail(screenId: string): Promise<SpecScreenDetail> {
  return fetchJson<SpecScreenDetail>(`screen-${screenId}.json`);
}

export function loadFieldDictionary(): Promise<SpecFieldDictionary> {
  return fetchJson<SpecFieldDictionary>('fields.json');
}

export function loadCommandExamples(): Promise<SpecCommandExample[]> {
  return fetchJson<SpecCommandExample[]>('commands.json');
}

export function loadUnleashItems(): Promise<SpecUnleashItem[]> {
  return fetchJson<SpecUnleashItem[]>('unleash.json');
}

export function loadAssetManifest(): Promise<SpecAssetManifest> {
  return fetchJson<SpecAssetManifest>('assets.json');
}

/** 상세 영역 첫 화면 SVG URL. 자산 목록을 함께 넘기면 실제 파일명을 사용한다. */
export function areaSvgUrl(areaId: string, manifest?: SpecAssetManifest | null): string {
  return screenSvgUrl(areaId, manifest ? manifest.screens : undefined);
}

export function resetSpecCache(): void {
  pending.clear();
}
