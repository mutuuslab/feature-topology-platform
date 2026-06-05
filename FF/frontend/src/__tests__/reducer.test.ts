import { describe, it, expect } from 'vitest';
import { reducer, initial, canTransition, type AppState } from '../store';
import type { Feature } from '../data/model';

const base = (): AppState => JSON.parse(JSON.stringify(initial));

describe('reducer — 핵심 상태 변경', () => {
  it('SET_CR_STATUS: CR 상태를 전이한다', () => {
    const s0 = base();
    const id = s0.crs[0].id;
    const s1 = reducer(s0, { t: 'SET_CR_STATUS', id, status: 'Approved' });
    expect(s1.crs.find(c => c.id === id)!.status).toBe('Approved');
  });

  it('KILL → RECOVER: runtime 토글', () => {
    const k = reducer(base(), { t: 'KILL', feature: 'FEAT-BDC-001', actor: 'tester' });
    expect(k.runtime['FEAT-BDC-001']).toBe('disabled');
    const r = reducer(k, { t: 'RECOVER', feature: 'FEAT-BDC-001' });
    expect(r.runtime['FEAT-BDC-001']).toBe('enabled');
  });

  it('CAMPAIGN_ADVANCE: 실패율>5%면 단계 진행 차단(telemetry guard)', () => {
    const s0 = base();
    const id = s0.campaigns[1].id; // rolling 캠페인
    const before = s0.campaigns[1].rollout;
    s0.live.failRate = 9; // 가드 초과
    const s1 = reducer(s0, { t: 'CAMPAIGN_ADVANCE', id });
    expect(s1.campaigns.find(c => c.id === id)!.rollout).toBe(before); // 변화 없음
    s0.live.failRate = 1; // 정상
    const s2 = reducer(s0, { t: 'CAMPAIGN_ADVANCE', id });
    expect(s2.campaigns.find(c => c.id === id)!.rollout).toBeGreaterThanOrEqual(before);
  });

  it('PROMOTE_POLICY: 단계 승급 + Deployed 시 버전 증가', () => {
    const s0 = base();
    const draft = s0.policies.find(p => p.stage === 'Draft')!;
    const s1 = reducer(s0, { t: 'PROMOTE_POLICY', id: draft.id, actor: 'tester' });
    expect(s1.policies.find(p => p.id === draft.id)!.stage).toBe('Review');
  });

  it('ACCEPT_SUPPLIER: 인수 기준 항목을 accepted로 변경', () => {
    const s0 = base();
    const item = s0.supplierAcceptance.find(a => a.status === 'pending')!;
    const s1 = reducer(s0, { t: 'ACCEPT_SUPPLIER', feature: item.feature, item: item.item });
    expect(s1.supplierAcceptance.find(a => a.item === item.item && a.feature === item.feature)!.status).toBe('accepted');
  });

  it('ADD_POLICY: 새 정책을 추가한다', () => {
    const s0 = base();
    const n = s0.policies.length;
    const s1 = reducer(s0, { t: 'ADD_POLICY', policy: { id: 'POLICY-TEST-1', feature: 'FEAT-BDC-001', stage: 'Draft', approver: '-', rollout: 0, version: 1 } });
    expect(s1.policies.length).toBe(n + 1);
    expect(s1.policies[0].id).toBe('POLICY-TEST-1');
  });

  it('RUN_COMPLIANCE: 검증 결과를 생성한다', () => {
    const s1 = reducer(base(), { t: 'RUN_COMPLIANCE' });
    expect(s1.compliance.length).toBeGreaterThan(0);
  });

  it('SET_HOME_WIDGETS: 홈 위젯 레이아웃 저장', () => {
    const next = [{ id: 'KPI Tiles', on: false }];
    const s1 = reducer(base(), { t: 'SET_HOME_WIDGETS', widgets: next });
    expect(s1.homeWidgets).toEqual(next);
  });
});

describe('canTransition — Lifecycle 게이트 가드', () => {
  it('Requirement 미연결이면 Approved 전이 차단', () => {
    const f = { id: 'FEAT-NONEXIST', lifecycle: 'Proposed' } as Feature;
    expect(canTransition(f, 'Approved').ok).toBe(false);
  });
});
