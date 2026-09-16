import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { severityMeta, SeverityBadge } from '../components/ui';
import { Steps } from '../components/charts';
import { domainOfPath, DOMAINS, DEPT_NAV, ITEM, PLANE_NAV, roleHomePath } from '../i18n';
import { ROLE_HOME_IMPL, SCREEN_ENTRY, SCREEN_LINKS } from '../data/uiLinks';
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
  it('홈·업무 영역 밖 경로는 업무 그룹이 없다 (삭제된 참조 문서 경로 포함)', () => {
    expect(domainOfPath('/')).toBe('work');                    // UI01 내 업무 = 홈
    expect(domainOfPath('/home/customize')).toBe('work');
    expect(domainOfPath('/spec/changelog')).toBe('');           // 기준 패키지 개정 이력 제거
    expect(domainOfPath('/no-such-route')).toBe('');
    expect(ITEM['/spec']).toBeUndefined();                     // 604 FR 기능명세 Overview 제거
    expect(ITEM['/spec/explorer']).toBeUndefined();             // FR Explorer 제거
    expect(ITEM['/spec/coverage']).toBeUndefined();             // Coverage 제거
  });

  it('서브내비 항목 순서가 정본 MENU 1.3 화면 순서 그대로다', () => {
    DOMAINS.forEach(d => {
      const specGroup = SPEC_MENU.find(g => g.id === d.key);
      const inMenu = specGroup!.items.filter(it => d.screens.some(s => s.id === it.id));
      expect(d.screens.map(s => s.id), d.key).toEqual(inMenu.map(it => it.id));
      expect(d.screens.map(s => s.ko), d.key).toEqual(inMenu.map(it => it.ko));
    });
  });

  it('메뉴는 화면당 항목 하나이고, 그 경로는 그 화면의 진입 경로다', () => {
    const paths = DOMAINS.flatMap(d => d.screens.map(s => s.to));
    expect(paths).toHaveLength(30);
    expect(paths).toHaveLength(new Set(paths).size);
    DOMAINS.forEach(d => d.screens.forEach(s => {
      expect(s.to, s.id).toBe(SCREEN_ENTRY[s.id]);
      expect(ITEM[s.to], `${s.id} ${s.to}`).toBeTruthy();
    }));
  });

  it('메뉴 소속 영역과 레일 하이라이트가 같은 답을 낸다 (손으로 적은 그룹 이름 없음)', () => {
    DOMAINS.forEach(d => d.screens.forEach(s => {
      expect(domainOfPath(s.to), `${d.key} → ${s.id} ${s.to}`).toBe(d.key);
    }));
  });
});

describe('부서별 보기 = 기준 9 역할', () => {
  it('부서는 9개 (기준 역할 키)', () => {
    expect(DEPT_NAV.length).toBe(9);
    expect(DEPT_NAV.map(d => d.role)).toEqual(
      ['author', 'approver', 'quality', 'operator', 'steward', 'commerce', 'integrator', 'coordinator', 'viewer']);
  });
  it('부서 화면이 모두 실제 메뉴 항목으로 해석된다', () => {
    DEPT_NAV.forEach(d => d.screens.forEach(s => {
      expect(ITEM[s.to], `${d.role} ${s.to}`).toBeTruthy();
    }));
  });
  it('모든 역할이 구현 화면을 갖는다', () => {
    DEPT_NAV.forEach(d => expect(d.screens.length, d.role).toBeGreaterThan(0));
  });
});

// 제품에는 실제 구현된 화면만 올린다. 요구사양 문서(기준 화면 정의서 /ui/UIxx, 기준 아키텍처 /arch,
// /spec/changelog, /spec/glossary)는 제품에 존재하지 않으므로 세 보기 어디에도 진입점이 없어야 한다.
describe('메뉴에는 구현 화면만 있다', () => {
  const menuItems = () => [
    ...DOMAINS.flatMap(d => d.screens.map(s => ({ where: `${d.key} / ${s.id}`, to: s.to }))),
    ...PLANE_NAV.flatMap(p => p.groups.flatMap(g => g.screens.map(s => ({ where: `${p.key} / ${g.ko}`, to: s.to })))),
    ...DEPT_NAV.flatMap(d => d.screens.map(s => ({ where: `${d.role} / ${s.id}`, to: s.to }))),
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
    PLANE_NAV.forEach(p => p.groups.forEach(g => g.screens.forEach(s => {
      expect(s.ko.startsWith('/'), `${p.key} / ${g.ko} → ${s.to}`).toBe(false);
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

  it('Plane·부서별 보기 화면이 1차 메뉴에 있는 화면이다', () => {
    const implSet = new Set(DOMAINS.flatMap(d => d.screens.map(s => s.id)));
    PLANE_NAV.forEach(p => p.groups.forEach(g => g.screens.forEach(s => {
      expect(implSet.has(s.id), `${p.key} / ${g.ko} → ${s.id}`).toBe(true);
    })));
    DEPT_NAV.forEach(d => d.screens.forEach(s => {
      expect(implSet.has(s.id), `${d.role} → ${s.id}`).toBe(true);
    }));
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
