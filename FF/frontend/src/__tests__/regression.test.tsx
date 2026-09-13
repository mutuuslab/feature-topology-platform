import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { severityMeta, SeverityBadge } from '../components/ui';
import { Steps } from '../components/charts';
import { domainOfPath, DOMAINS, DEPT_NAV, ITEM } from '../i18n';
import { platformGlossary } from '../data/platformGlossary';

describe('네비 도메인 매핑 (안 B)', () => {
  it('라우트 첫 세그먼트 → 올바른 도메인', () => {
    expect(domainOfPath('/')).toBe('home');
    expect(domainOfPath('/catalog')).toBe('feature');
    expect(domainOfPath('/spec/changelog')).toBe('feature');   // 참조(기준 문서)는 Feature 유지
    expect(ITEM['/spec']).toBeUndefined();                     // 604 FR 기능명세 Overview 제거
    expect(ITEM['/spec/explorer']).toBeUndefined();             // FR Explorer 제거
    expect(ITEM['/spec/coverage']).toBeUndefined();             // Coverage 제거
    expect(domainOfPath('/feature/FEAT-BDC-001')).toBe('feature');
    expect(domainOfPath('/impact')).toBe('lifecycle');
    expect(domainOfPath('/ops/FEAT-BDC-001')).toBe('operate');
    expect(domainOfPath('/integration/sync')).toBe('operate');
    expect(domainOfPath('/admin/users')).toBe('governance');
    expect(domainOfPath('/supplier/portal')).toBe('governance');
    expect(domainOfPath('/insights/audit')).toBe('insights');
  });
  it('도메인은 6개', () => { expect(DOMAINS.length).toBe(6); });
});

describe('부서별 보기 (안 2)', () => {
  it('부서는 8개(P1~P7+Admin)', () => { expect(DEPT_NAV.length).toBe(8); });
  it('부서 메뉴 경로가 모두 실제 NAV 항목으로 해석된다', () => {
    DEPT_NAV.forEach(d => d.sections.forEach(s => s.paths.forEach(p => {
      expect(ITEM[p], `${d.role} ${p}`).toBeTruthy();
    })));
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
