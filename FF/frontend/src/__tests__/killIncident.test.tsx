// 긴급 차단 사건 단위 패널(P11a, ADS-UI02·BE02·BE21·FR-AGW-001-002) — 핵심 메시지·사건별 차단·다른 사건 차단 유지·영향 3분류·복원 3단·접수함
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DATA: Record<string, unknown> = {};
vi.mock('../api/hooks', () => ({
  useApi: (name: string) => ({ data: DATA[name] }),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../screens/shared', () => ({ usePermission: () => ({ ok: true }), when: (s: string) => s }));
const { ImpactSetPanel, IncidentInhibits, IntakeQueue, RestoreThreeState, TerminationOutcome } = await import('../screens/ops/KillIncidentPanels');

afterEach(() => {
  cleanup();
  for (const k of Object.keys(DATA)) delete DATA[k];
});
const pt = (trust: 'TRUSTED' | 'UNCERTAIN') => ({ trust });

describe('사건 단위 패널', () => {
  it('핵심 메시지 — 종료 결과 미확인 차량 N대와 배타 구간 분포', () => {
    DATA.killTimeline = {
      items: [
        { vin: 'A', deactivate: { accepted: pt('TRUSTED'), completed: pt('TRUSTED'), mrc: null }, uncertain: [] },
        { vin: 'B', deactivate: { accepted: pt('TRUSTED'), completed: null, mrc: null }, uncertain: [] },
        { vin: 'C', deactivate: null, uncertain: [] },
      ],
    };
    render(<TerminationOutcome killId="KILL-00001" deadlinePassed />);
    const o = screen.getByTestId('kill-outcome');
    expect(o.dataset.unconfirmed).toBe('2');
    expect(o.textContent).toContain('종료 결과 미확인 차량 2대');
    expect(o.textContent).toContain('비활성 확인 1 · 전환 중 1 · 시간 초과 1');
  });
  it('사건별 종료 차단 — 이 차단 차량 중 다른 사건 차단이 남는 차량을 보인다', () => {
    DATA.terminationInhibits = {
      incidents: [
        { incidentId: 'INC-A', featureId: 'FEAT-00022', killId: 'KILL-00001', active: 2, released: 0, setAt: 't1', releasedAt: null },
        { incidentId: 'INC-B', featureId: 'FEAT-00022', killId: 'KILL-00002', active: 1, released: 0, setAt: 't0', releasedAt: null },
      ],
      vehicles: [
        { vin: 'ego-01', incidents: ['INC-A', 'INC-B'] },
        { vin: 'lead-01', incidents: ['INC-A'] },
      ],
    };
    render(<IncidentInhibits featureId="FEAT-00022" incidentId="INC-A" vins={['ego-01', 'lead-01']} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByTestId('held-by-other').textContent).toContain('ego-01(INC-B)');
  });
  it('영향 차량 3분류 — 확정 영향군이 없으면 정확도 판단 불가', () => {
    DATA.impactSet = { current: { setId: 'IMP-00001', configAsOf: 't', counts: { CANDIDATE: 2, CONFIG_UNKNOWN: 1, NO_CONTACT: 1 } }, history: [{}], accuracy: { status: 'UNKNOWN', value: null, candidates: 2, confirmed: 0, matched: 0 } };
    render(<ImpactSetPanel incidentId="INC-A" />);
    const t = screen.getByTestId('kill-impact').textContent ?? '';
    expect(t).toContain('영향 후보2');
    expect(t).toContain('통신 미수신1');
    expect(t).toContain('판단 불가');
  });
  it('복원 3단 — 활성화 불가도 정상 조합으로 보인다', () => {
    render(<RestoreThreeState verified released={false} activatable={false} />);
    const t = screen.getByTestId('restore-3state').textContent ?? '';
    expect(t).toContain('복구 검증 완료예');
    expect(t).toContain('종료 차단 해제아니요');
    expect(t).toContain('활성화 불가도 정상 조합');
  });
  it('접수함 — 검토 대기 접수가 없으면 패널을 그리지 않고, 있으면 옮기기 링크가 그 Feature·접수로 연다', () => {
    const { container } = render(<MemoryRouter><IntakeQueue /></MemoryRouter>);
    expect(container.textContent).toBe('');
    cleanup();
    DATA.killIntakes = { items: [{ intakeId: 'KIN-00001', source: 'ANOMALY', status: 'RECEIVED', featureId: 'FEAT-00022', featureVersion: '1.0.0', reason: '중단 필요', vins: ['ego-01'], anomalyId: 'ANM-00001', externalRef: null, receivedAt: 't' }] };
    render(<MemoryRouter><IntakeQueue /></MemoryRouter>);
    const link = screen.getByRole('link', { name: '차단 요청으로 옮기기' });
    expect(link.getAttribute('href')).toBe('/ops/kill?featureId=FEAT-00022&version=1.0.0&intake=KIN-00001&anomaly=ANM-00001');
  });
});
