import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_SCREENS, SPEC_GROUPS, SPEC_COUNTS, SPEC_ROLES, SPEC_STATES, SPEC_SCREEN_BY_ID } from '../data/specNav';
import type { SpecScreenDetail } from '../data/specTypes';
import { SPEC_MENU } from '../data/specMenu';
import { ROLE_HOME_IMPL, SCREEN_LINKS, screenOfRoute } from '../data/uiLinks';
import { specAsset, screenSvgUrl } from '../data/specAssets';
import {
  SPEC_PLANE_CORE_OF_SCREEN, SPEC_KNOWLEDGE_FOUNDATION, SPEC_PLANE_NAV, SPEC_PLANE_OF_SCREEN,
  SPEC_SCREEN_PLANE, specPlaneOfPath,
} from '../data/specPlanesNav';
import { SPEC_PLANES, SPEC_PLANE_NOTE } from '../data/specArch';
import { PLANE_NAV, DEMO_GROUPS } from '../i18n';

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

describe('1차 메뉴 (specMenu) ↔ 기준 (specNav) 정합', () => {
  it('그룹 id·순서와 소속 화면이 기준과 완전히 같다', () => {
    expect(SPEC_MENU.map((g) => g.id)).toEqual(SPEC_GROUPS.map((g) => g.id));
    SPEC_MENU.forEach((g, i) => expect(g.items.map((it) => it.id)).toEqual(SPEC_GROUPS[i].screens));
  });

  it('30개 화면의 이름·담당 역할·유형이 기준과 같다', () => {
    const ids: string[] = [];
    SPEC_MENU.forEach((g) => g.items.forEach((it) => {
      ids.push(it.id);
      const s = SPEC_SCREEN_BY_ID[it.id];
      expect(it.ko, it.id).toBe(s.name);
      expect(it.owner, it.id).toBe(s.owner);
      expect(it.kind, it.id).toBe(s.kind);
    }));
    expect(ids).toHaveLength(SPEC_COUNTS.screens);
    expect(new Set(ids).size).toBe(SPEC_COUNTS.screens);
  });

  it('역할별 착지 화면이 모두 실재하는 화면이다', () => {
    SPEC_ROLES.forEach((r) => {
      const path = ROLE_HOME_IMPL[r.key];
      expect(path, r.key).toBeTruthy();
      expect(path.startsWith('/ui'), r.key).toBe(false);
    });
    expect(Object.keys(ROLE_HOME_IMPL)).toHaveLength(SPEC_ROLES.length);
  });
});

describe('요구사양 문서 화면은 제품에 없다', () => {
  it('/ui · /arch · /spec/changelog · /spec/glossary 라우트가 등록되어 있지 않다', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf-8');
    ['/ui', '/ui/:uiId', '/ui/:uiId/:areaId', '/arch', '/spec/changelog', '/spec/glossary'].forEach((p) => {
      expect(app.includes(`path="${p}"`), p).toBe(false);
    });
  });
});

describe('Plane별 보기 (4 Plane · 공유 기반)', () => {
  it('Plane 이름·산출물·계약이 기준 아키텍처와 완전히 같다', () => {
    const planes = SPEC_PLANE_NAV.filter((p) => !p.shared);
    expect(planes).toHaveLength(SPEC_PLANES.length);
    planes.forEach((p, i) => {
      expect(p.name).toBe(SPEC_PLANES[i].name);
      expect(p.produces).toBe(SPEC_PLANES[i].produces);
      expect(p.contract).toBe(SPEC_PLANES[i].contract);
    });
    // Knowledge Foundation은 다섯 번째 Plane이 아니다 — 공유 기반으로만 표시한다.
    const shared = SPEC_PLANE_NAV.filter((p) => p.shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].contract).toContain(SPEC_PLANE_NOTE);
    expect(shared[0].contract).toBe(SPEC_KNOWLEDGE_FOUNDATION);
    expect(shared[0].produces).toBe('—');
  });

  it('30개 기준 화면이 대표 Plane 하나씩에 정확히 배정된다', () => {
    const ids = SPEC_MENU.flatMap((g) => g.items.map((it) => it.id));
    const assigned = SPEC_PLANE_NAV.flatMap((p) => p.screens);
    expect(assigned.slice().sort()).toEqual(ids.slice().sort());
    expect(new Set(assigned).size).toBe(ids.length);
    ids.forEach((id) => expect(SPEC_PLANE_OF_SCREEN[id], id).toBeTruthy());
    expect(Object.keys(SPEC_PLANE_OF_SCREEN)).toHaveLength(SPEC_COUNTS.screens);
  });

  it('대표 Plane 배정이 기준 정본(planeAssignment)과 화면별로 일치한다', () => {
    // 정본: specPlanesGen.SPEC_SCREEN_PLANE (FP_UI_Operations v3.9 cores[49] allocation)
    const PLANE_ID: Record<string, string> = {
      Control: 'control', Quality: 'quality', 'Governance+Monitoring': 'governance', Vehicle: 'vehicle',
    };
    expect(Object.keys(SPEC_PLANE_OF_SCREEN).slice().sort())
      .toEqual(Object.keys(SPEC_SCREEN_PLANE).slice().sort());
    Object.entries(SPEC_SCREEN_PLANE).forEach(([screen, name]) => {
      expect(SPEC_PLANE_OF_SCREEN[screen], screen).toBe(PLANE_ID[name]);
      // 화면은 반드시 소유 Core의 Plane에 들어간다.
      expect(specPlaneOfPath(`/ui/${screen}`), screen).toBe(PLANE_ID[name]);
      expect(SPEC_PLANE_CORE_OF_SCREEN[screen], screen).toBeTruthy();
    });
    // 4 Plane 합계 = 49 Core, 화면 소유 Plane별 Core 수와 일치
    const totalCores = SPEC_PLANE_NAV.filter((p) => !p.shared).reduce((n, p) => n + p.coreIds.length, 0);
    expect(totalCores).toBe(49);
    expect(SPEC_PLANE_NAV.filter((p) => !p.shared).map((p) => p.screens.length).reduce((a, b) => a + b, 0))
      .toBe(SPEC_COUNTS.screens);
  });

  it('공유 기반 레일은 화면을 소유하지 않는다 (다섯 번째 Plane이 아님)', () => {
    const shared = SPEC_PLANE_NAV.filter((p) => p.shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].screens).toEqual([]);
    expect(shared[0].screenGroups).toEqual([]);
    expect(shared[0].coreIds).toEqual([]);
    Object.values(SPEC_PLANE_OF_SCREEN).forEach((plane) => expect(plane).not.toBe('shared'));
  });

  it('Plane 안의 화면 묶음은 MENU 1.3 업무 그룹을 그대로 쓴다', () => {
    const specGroupNames = SPEC_MENU.map((g) => g.ko);
    SPEC_PLANE_NAV.forEach((p) => p.screenGroups.forEach((g) => {
      const owner = specGroupNames.filter((n) => g.ko.startsWith(n));
      expect(owner, `${p.id}/${g.ko}`).toHaveLength(1);
      // 묶음에 든 화면은 모두 그 업무 그룹 소속이다.
      g.screens.forEach((id) => {
        const groupId = SPEC_MENU.find((m) => m.items.some((it) => it.id === id))?.id;
        expect(SPEC_MENU.find((m) => m.ko === owner[0])?.id, `${p.id}/${id}`).toBe(groupId);
      });
    }));
  });

  it('구현 데모 화면이 빠짐없이 한 Plane에만 들어간다', () => {
    const all = DEMO_GROUPS.flatMap((g) => g.items.map((it) => it.to));
    const placed = SPEC_PLANE_NAV.flatMap((p) => p.demos.flatMap((d) => d.routes));
    expect(placed).toHaveLength(new Set(placed).size);
    all.forEach((r) => expect(placed, r).toContain(r));
    expect(SPEC_PLANE_NAV.flatMap((p) => p.demos.flatMap((d) => d.routes)).length)
      .toBeGreaterThanOrEqual(all.length);
  });

  it('경로로 대표 Plane을 되찾을 수 있다', () => {
    expect(specPlaneOfPath('/ui/UI02')).toBe('control');
    expect(specPlaneOfPath('/ui/UI16')).toBe('quality');
    expect(specPlaneOfPath('/ui/UI11')).toBe('governance');
    expect(specPlaneOfPath('/ui/UI12')).toBe('vehicle');
    // 기준 정본 배정을 그대로 따르는지 (손 배정 금지)
    expect(specPlaneOfPath('/ui/UI01')).toBe('governance');
    expect(specPlaneOfPath('/ui/UI06')).toBe('quality');
    expect(specPlaneOfPath('/ui/UI28')).toBe('quality');
    expect(specPlaneOfPath('/ui/UI29')).toBe('quality');
    expect(specPlaneOfPath('/ui/UI14')).toBe('governance');
    expect(specPlaneOfPath('/ui/UI25')).toBe('governance');
    expect(specPlaneOfPath('/ui/UI27')).toBe('governance');
    expect(specPlaneOfPath('/ui/UI02/UI02-S04')).toBe('control');
    expect(specPlaneOfPath('/master/artifacts')).toBe('control');
    expect(specPlaneOfPath('/master/control-points')).toBe('control');
    expect(specPlaneOfPath('/twin/live')).toBe('vehicle');
    expect(specPlaneOfPath('/admin/users')).toBe('governance');
    expect(specPlaneOfPath('/verify/evidence')).toBe('quality');
    expect(specPlaneOfPath('/unknown/route')).toBeUndefined();
  });

  it('셸이 세 번째 네비 모드로 Plane을 제공한다', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf-8');
    expect(app.includes("setMode('plane')")).toBe(true);
    expect(app.includes("navMode === 'plane'")).toBe(true);
    const store = readFileSync(join(process.cwd(), 'src', 'store.tsx'), 'utf-8');
    expect(store.includes("'function' | 'dept' | 'plane'")).toBe(true);
    // 레일 라벨은 구현된 4 Plane 뿐이다(공유 기반은 참조 영역과 함께 사라졌다). 라벨·그룹을 모두 갖는다.
    expect(PLANE_NAV).toHaveLength(SPEC_PLANES.length);
    expect(PLANE_NAV.some((p) => p.key === 'shared')).toBe(false);
    PLANE_NAV.forEach((p) => {
      expect(p.ko.length, p.key).toBeGreaterThan(0);
      expect(p.en.length, p.key).toBeGreaterThan(0);
      expect(p.groups.length, p.key).toBeGreaterThan(0);
      p.groups.forEach((g) => expect(g.items.length, `${p.key}/${g.ko}`).toBeGreaterThan(0));
    });
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
