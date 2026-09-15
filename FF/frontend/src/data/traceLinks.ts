// UI30 요구사항과 설계 추적 — 기준 화면 ID 와 설계 영역 ID 접두가 같은 것만 잇는다.
import { SPEC_SW_SECTIONS } from '../data/specArch';
import { implementedLinks, navPathOfLink } from '../data/uiLinks';

const norm = (v: unknown) => String(v ?? '');

/** 요구 추적에 쓰는 설계 영역 행 — [영역ID+이름, 객체, 페이로드, 목적] */
export interface DesignAreaRow { id: string; object: string; payload: string; purpose: string }

/** 기준 화면의 설계 영역 행을 모은다 (영역 ID 접두 = 화면 ID). */
export function designAreasOf(screenId: string): DesignAreaRow[] {
  if (!screenId) return [];
  const out: DesignAreaRow[] = [];
  SPEC_SW_SECTIONS.forEach(section => {
    (section.blocks || []).forEach((block: any) => {
      (block.rows || []).forEach((row: any[]) => {
        const id = norm(row[0]);
        if (!id.startsWith(`${screenId}-S`)) return;
        out.push({ id, object: norm(row[1]), payload: norm(row[2]), purpose: norm(row[3]) });
      });
    });
  });
  return out;
}

/** 기준 화면이 실제로 구현된 첫 메뉴 경로 (없으면 빈 문자열). */
export function menuPathOfScreen(screenId: string): string {
  const link = implementedLinks(screenId).links.map(navPathOfLink).find(p => p.startsWith('/') && !p.includes(':'));
  return link || '';
}
