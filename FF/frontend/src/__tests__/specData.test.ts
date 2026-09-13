import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_SCREENS, SPEC_GROUPS, SPEC_COUNTS, SPEC_ROLES, SPEC_STATES } from '../data/specNav';
import type { SpecScreenDetail } from '../data/specTypes';
import { SCREEN_LINKS, screenOfRoute } from '../data/uiLinks';
import { specAsset, screenSvgUrl } from '../data/specAssets';

const DATA_DIR = join(process.cwd(), 'public', 'spec', 'data');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf-8')) as T;
}

const screens = SPEC_SCREENS.map((s) => s.id).map((id) => readJson<SpecScreenDetail>(`screen-${id}.json`));

describe('기준 패키지 데이터 (FP-DETAILED-1.1)', () => {
  it('화면 30개를 모두 싣고 그룹·역할이 기준과 맞는다', () => {
    expect(screens).toHaveLength(SPEC_COUNTS.screens);
    expect(SPEC_GROUPS).toHaveLength(SPEC_COUNTS.groups);
    const groupIds = SPEC_GROUPS.map((g) => g.id);
    screens.forEach((s) => expect(groupIds).toContain(s.group));
    expect(SPEC_ROLES).toHaveLength(9);
    expect(SPEC_STATES).toHaveLength(SPEC_COUNTS.states);
  });

  it('상세 영역 186 · 작업 581 이고 영역 ID는 전역 유일하다', () => {
    const areas = screens.flatMap((s) => s.areas);
    const tasks = screens.flatMap((s) => s.areas).flatMap((a) => a.tasks);
    expect(areas.length).toBe(SPEC_COUNTS.submenus);
    expect(tasks.length).toBe(SPEC_COUNTS.tasks);
    expect(new Set(areas.map((a) => a.id)).size).toBe(areas.length);
    // 작업 라벨은 사람이 읽는 문장이라 같은 문구가 다른 영역에 반복될 수 있다(UI06-S06 · UI23-S06).
    expect(tasks.every((t) => t.trim().length > 0)).toBe(true);
    screens.forEach((s) => {
      expect(s.counts.areas).toBe(s.areas.length);
      s.areas.forEach((a) => expect(a.tasks.length).toBeGreaterThan(0));
    });
  });

  it('영역마다 상태 9종·역할 정책·응답 계약을 갖는다', () => {
    const stateIds = SPEC_STATES.map((s) => s.id);
    screens.forEach((s) => {
      s.areas.forEach((a) => {
        expect(a.states.map((x) => x.state)).toEqual(stateIds);
        expect(a.rolePolicy.read.length).toBeGreaterThan(0);
        expect(a.responseColumns.length).toBeGreaterThan(0);
      });
      expect(s.areas.some((a) => a.id === s.defaultSubmenu)).toBe(true);
    });
  });

  it('속성 사전은 FRI 184 + OPA 249 이고 명령·Unleash 항목이 기준 개수와 맞는다', () => {
    const fields = readJson<{ fri: { id: string; dictionary: string; group: string }[]; opa: unknown[]; groups: unknown[] }>('fields.json');
    expect(fields.fri).toHaveLength(SPEC_COUNTS.FRI + SPEC_COUNTS.OPA);
    expect(fields.fri.filter((f) => f.dictionary === 'FRI')).toHaveLength(SPEC_COUNTS.FRI);
    expect(fields.opa).toHaveLength(SPEC_COUNTS.OPA);
    expect(fields.groups).toHaveLength(14);
    expect(new Set(fields.fri.map((f) => f.id)).size).toBe(fields.fri.length);
    expect(readJson<unknown[]>('commands.json')).toHaveLength(234);
    expect(readJson<unknown[]>('unleash.json')).toHaveLength(235);
  });

  it('모든 상세 영역에 첫 화면 SVG가 있다', () => {
    const manifest = readJson<{ screens: string[] }>('assets.json');
    const areaIds = screens.flatMap((s) => s.areas.map((a) => a.id));
    areaIds.forEach((id) => {
      const url = screenSvgUrl(id, manifest.screens);
      expect(url.endsWith(`/spec/screens/${url.split('/').pop()}`)).toBe(true);
      // 추정 파일명이 아니라 실제 파일명을 골랐는지 확인
      expect(manifest.screens.some((f) => f.startsWith(`${id}_`))).toBe(true);
    });
    expect(manifest.screens).toHaveLength(areaIds.length + 5);
  });

  it('자산 URL은 배포 기준 경로를 따른다', () => {
    expect(specAsset('data/fields.json')).toBe('/spec/data/fields.json');
    expect(specAsset('/arch/C01_Architecture.svg')).toBe('/spec/arch/C01_Architecture.svg');
    expect(screenSvgUrl('UI02-S01')).toBe('/spec/screens/UI02-S01_First_Screen_v1_1.svg');
  });
});

describe('기준 화면 ↔ 구현 화면 연결표', () => {
  it('UI01~UI30 모두에 연결이 있다', () => {
    const ids = SPEC_SCREENS.map((s) => s.id);
    ids.forEach((id) => {
      expect(SCREEN_LINKS[id]).toBeDefined();
      expect(SCREEN_LINKS[id].links.length).toBeGreaterThan(0);
    });
  });

  it('연결 경로는 앱 라우트 형태이고 역조회가 동작한다', () => {
    Object.values(SCREEN_LINKS).forEach((entry) => {
      entry.links.forEach((l) => expect(l.path.startsWith('/')).toBe(true));
    });
    expect(screenOfRoute('/twin/vehicle/VIN-DEMO-017')).toBe('UI12');
    expect(screenOfRoute('/master/define')).toBe('UI02');
    expect(screenOfRoute('/change/timeline')).toBe('UI14');
  });

  it('연결한 구현 화면 경로가 실제 라우트로 존재한다', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf-8');
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)]
      .map((m) => m[1].split('/').filter(Boolean));
    const matchesAnyRoute = (path: string) => {
      const segs = path.split('/').filter(Boolean);
      if (segs.length === 0) return routes.some((r) => r.length === 0);
      return routes.some((r) => r.length === segs.length
        && r.every((rseg, i) => rseg.startsWith(':') || rseg.toLowerCase() === segs[i].toLowerCase()));
    };
    Object.values(SCREEN_LINKS).forEach((entry) => {
      entry.links.forEach((l) => expect(matchesAnyRoute(l.path)).toBe(true));
    });
  });
});
