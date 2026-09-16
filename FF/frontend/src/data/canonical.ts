// 정본 상세 영역(UIxx-S0n) 표 — 기준 패키지가 정의한 **영역 이름·성격·배치**만 담는다.
//
// 원천은 생성된 정본 표 `screenAreas.ts` 하나다. 영역 이름을 여기서 다시 손으로 적지 않는다.
// 화면 본문은 이 표를 영역 탭 목록으로 쓰고, 각 영역의 데이터·동작은 페이지가 소유한다.
// 제품에는 요구사양 문서를 두지 않으므로 영역 이름·성격·배치 외의 문서 서술은 담지 않는다.
import { SCREEN_AREA_BY_ID, SCREEN_CANON_BY_ID, type ScreenAreaCanon } from './screenAreas';

export interface CanonArea {
  id: string;
  name: string;
  /** 영역 성격 코드 (정본 taxonomy: table · form · graph …) */
  kind: string;
  /** 정본 배치 이름 (예: 목록과 상세 패널) */
  layout: string;
  /** 영역이 다루는 정본 객체 */
  object: string;
}

/** 정본 영역 6개에 실제 구현 본문까지 갖춘 화면 — 영역 탭을 쓰는 화면 목록. */
export const CANON_IMPLEMENTED_SCREENS: string[] = [
  'UI19', 'UI28', 'UI07', 'UI21', 'UI22', 'UI23', 'UI24', 'UI26', 'UI30',
];

function toCanonArea(a: ScreenAreaCanon): CanonArea {
  return { id: a.id, name: a.name, kind: a.type, layout: a.layout, object: a.object };
}

export const CANON_AREAS: Record<string, CanonArea[]> = Object.fromEntries(
  CANON_IMPLEMENTED_SCREENS.map((id) => [id, (SCREEN_CANON_BY_ID[id]?.areas || []).map(toCanonArea)]),
);

export const areasOf = (screenId: string): CanonArea[] => CANON_AREAS[screenId] || [];

/** 정본 영역 정의 한 건 (30개 화면 · 186개 영역 전체). */
export const canonArea = (areaId: string): (ScreenAreaCanon & { screenId: string }) | undefined =>
  SCREEN_AREA_BY_ID[areaId];

/** 정본 영역 이름 — 구현 뷰의 표시 이름을 정본에 맞출 때 쓴다. */
export const canonAreaName = (areaId?: string): string | undefined =>
  areaId ? SCREEN_AREA_BY_ID[areaId]?.name : undefined;
