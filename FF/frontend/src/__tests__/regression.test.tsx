import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { severityMeta, SeverityBadge } from '../components/ui';
import { Steps } from '../components/charts';
import { domainOfPath, DOMAINS, DEPT_NAV, ITEM, PLANE_NAV, roleHomePath } from '../i18n';
import { ROLE_HOME_IMPL, SCREEN_LINKS } from '../data/uiLinks';
import { SPEC_MENU } from '../data/specMenu';

describe('1차 IA = 기준 패키지 7 업무 그룹 (MENU 1.3)', () => {
  it('도메인은 7개 (기준 업무 그룹 순서)', () => {
    expect(DOMAINS.map(d => d.key)).toEqual(['work', 'feature', 'config', 'release', 'vehicle', 'quality', 'admin']);
  });
  it('구현 데모 화면은 연결된 기준 화면의 업무 그룹으로 해석된다', () => {
    expect(domainOfPath('/catalog')).toBe('feature');              // UI02 / UI07
    expect(domainOfPath('/master/bom')).toBe('config');            // UI03 / UI04
    expect(domainOfPath('/readiness/FEAT-BDC-001')).toBe('release'); // UI10
    expect(domainOfPath('/ops/incident')).toBe('vehicle');         // UI13
    expect(domainOfPath('/verify/evidence')).toBe('quality');      // UI16
    expect(domainOfPath('/admin/users')).toBe('admin');            // UI17
  });
  it('업무 그룹 밖 경로는 그룹 없음 → 구현 화면 전체 목록', () => {
    expect(domainOfPath('/')).toBe('');
    expect(domainOfPath('/spec/changelog')).toBe('');
    expect(ITEM['/spec']).toBeUndefined();                     // 604 FR 기능명세 Overview 제거
    expect(ITEM['/spec/explorer']).toBeUndefined();             // FR Explorer 제거
    expect(ITEM['/spec/coverage']).toBeUndefined();             // Coverage 제거
  });
});

describe('부서별 보기 = 기준 9 역할', () => {
  it('부서는 9개 (기준 역할 키)', () => {
    expect(DEPT_NAV.length).toBe(9);
    expect(DEPT_NAV.map(d => d.role)).toEqual(
      ['author', 'approver', 'quality', 'operator', 'steward', 'commerce', 'integrator', 'coordinator', 'viewer']);
  });
  it('부서 메뉴 경로가 모두 실제 NAV 항목으로 해석된다', () => {
    DEPT_NAV.forEach(d => d.sections.forEach(s => s.paths.forEach(p => {
      expect(ITEM[p], `${d.role} ${p}`).toBeTruthy();
    })));
  });
  it('모든 역할이 구현 화면 섹션을 갖는다', () => {
    DEPT_NAV.forEach(d => expect(d.sections.length, d.role).toBeGreaterThan(0));
  });
});

// 제품에는 실제 구현된 화면만 올린다. 요구사양 문서(기준 화면 정의서 /ui/UIxx, 기준 아키텍처 /arch,
// /spec/changelog, /spec/glossary)는 제품에 존재하지 않으므로 세 보기 어디에도 진입점이 없어야 한다.
describe('메뉴에는 구현 화면만 있다', () => {
  const menuItems = () => [
    ...DOMAINS.flatMap(d => d.groups.flatMap(g => g.items.map(it => ({ where: `${d.key} / ${g.ko}`, to: it.to })))),
    ...PLANE_NAV.flatMap(p => p.groups.flatMap(g => g.items.map(it => ({ where: `${p.key} / ${g.ko}`, to: it.to })))),
    ...DEPT_NAV.flatMap(d => d.sections.flatMap(s => s.paths.map(to => ({ where: `${d.role} / ${s.ko}`, to })))),
  ];

  it('세 보기 어디에도 기준 화면 정의서가 메뉴로 올라오지 않는다', () => {
    const leaked = menuItems().filter(i => /^\/ui\/UI\d\d/.test(i.to) || /^UI\d\d/.test(i.to));
    expect(leaked, JSON.stringify(leaked)).toEqual([]);
  });

  it('참조 문서 경로(/ui · /arch · /spec/changelog · /spec/glossary)는 어느 보기에도 없다', () => {
    const banned = new Set(['/ui', '/arch', '/spec/changelog', '/spec/glossary']);
    const leaked = menuItems().filter(i => banned.has(i.to));
    expect(leaked, JSON.stringify(leaked)).toEqual([]);
  });
  it('정의서를 참조하지만 메뉴에 없던 공백은 없다 (Plane 항목 라벨 보장)', () => {
    PLANE_NAV.forEach(p => p.groups.forEach(g => g.items.forEach(it => {
      expect(it.ko.startsWith('/'), `${p.key} / ${g.ko} → ${it.to}`).toBe(false);
    })));
  });

  it('메뉴 항목이 모두 실제 라우트로 열린다', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf-8');
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1].split('/').filter(Boolean));
    const matchesRoute = (path: string) => {
      const segs = path.split('/').filter(Boolean);
      if (segs.length === 0) return routes.some(r => r.length === 0);
      return routes.some(r => r.length === segs.length
        && r.every((rseg, i) => rseg.startsWith(':') || rseg.toLowerCase() === segs[i].toLowerCase()));
    };
    menuItems().forEach(i => expect(matchesRoute(i.to), `${i.where} → ${i.to}`).toBe(true));
  });

  it('Plane·부서별 보기는 1차 메뉴 경로만 쓴다', () => {
    const implSet = new Set(DOMAINS.flatMap(d => d.groups.flatMap(g => g.items.map(it => it.to))));
    PLANE_NAV.forEach(p => p.groups.forEach(g => g.items.forEach(it => {
      expect(implSet.has(it.to), `${p.key} / ${g.ko} → ${it.to}`).toBe(true);
    })));
    DEPT_NAV.forEach(d => d.sections.forEach(s => s.paths.forEach(p => {
      expect(implSet.has(p), `${d.role} → ${p}`).toBe(true);
    })));
  });

  it('역할 기본 착지도 구현 화면이고, 그 역할이 소유한 기준 화면에 연결돼 있다', () => {
    expect(Object.keys(ROLE_HOME_IMPL).sort()).toEqual(DEPT_NAV.map(d => d.role).sort());
    Object.entries(ROLE_HOME_IMPL).forEach(([role, to]) => {
      expect(to.startsWith('/ui'), role).toBe(false);
      expect(ITEM[to], `${role} ${to}`).toBeTruthy();
      expect(roleHomePath(role)).toBe(to);
      const owned = SPEC_MENU.flatMap(g => g.items.filter(it => it.owner === role).map(it => it.id));
      expect(owned.length, role).toBeGreaterThan(0);
      const linked = owned.flatMap(id => SCREEN_LINKS[id].links.map(l => l.path));
      expect(linked, `${role} ${to}`).toContain(to);
    });
  });
});

describe('회귀 — Consistency severity 정규화', () => {
  it('코드 B/W/I → 풀네임 라벨', () => {
    expect(severityMeta('B').label).toBe('Blocking');
    expect(severityMeta('W').label).toBe('Warning');
    expect(severityMeta('I').label).toBe('Info');
  });
  it('풀네임 입력도 동일 메타로 정규화', () => {
    expect(severityMeta('blocking').color).toBe(severityMeta('B').color);
  });
});

describe('컴포넌트 스모크', () => {
  it('SeverityBadge가 라벨을 렌더', () => {
    render(<SeverityBadge code="B" />);
    expect(screen.getByText(/Blocking/)).toBeInTheDocument();
  });
  it('Steps가 모든 단계를 렌더', () => {
    render(<Steps steps={['A', 'B', 'C']} current={1} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});
