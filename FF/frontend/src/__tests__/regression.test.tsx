import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { severityMeta, SeverityBadge } from '../components/ui';
import { Steps } from '../components/charts';
import { domainOfPath, DOMAINS, DEPT_NAV, ITEM } from '../i18n';
import { platformGlossary } from '../data/platformGlossary';

describe('1차 IA = 기준 패키지 7 업무 그룹 (MENU 1.3)', () => {
  it('도메인은 7개 (기준 업무 그룹 순서)', () => {
    expect(DOMAINS.map(d => d.key)).toEqual(['work', 'feature', 'config', 'release', 'vehicle', 'quality', 'admin']);
  });
  it('기준 화면(/ui/UIxx)은 소속 업무 그룹으로 해석된다', () => {
    expect(domainOfPath('/ui/UI02')).toBe('feature');
    expect(domainOfPath('/ui/UI11')).toBe('vehicle');
    expect(domainOfPath('/ui/UI30')).toBe('quality');
  });
  it('구현 데모 화면은 연결된 기준 화면의 업무 그룹으로 해석된다', () => {
    expect(domainOfPath('/catalog')).toBe('feature');              // UI02 / UI07
    expect(domainOfPath('/master/bom')).toBe('config');            // UI03 / UI04
    expect(domainOfPath('/readiness/FEAT-BDC-001')).toBe('release'); // UI10
    expect(domainOfPath('/ops/incident')).toBe('vehicle');         // UI13
    expect(domainOfPath('/verify/evidence')).toBe('quality');      // UI16
    expect(domainOfPath('/admin/users')).toBe('admin');            // UI17
  });
  it('업무 그룹 밖 경로는 그룹 없음 → 기준 참조 목록', () => {
    expect(domainOfPath('/')).toBe('');
    expect(domainOfPath('/arch')).toBe('');
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
  it('담당 화면이 없는 역할도 공통 참조 화면을 갖는다', () => {
    DEPT_NAV.forEach(d => expect(d.sections.length, d.role).toBeGreaterThan(0));
  });
});

describe('플랫폼 Glossary 보강', () => {
  it('핵심 용어 포함 + 항목 충분', () => {
    expect(platformGlossary.length).toBeGreaterThanOrEqual(40);
    const terms = platformGlossary.map(g => g.term);
    ['Kill Switch', 'Safe Default', 'OTA', 'Variant', '9-Gate'].forEach(t => expect(terms).toContain(t));
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
