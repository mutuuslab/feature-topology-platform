// P10 Gate 탭 보강 — 해당 없음(N/A) 상태 표시, 최종 Go/No-Go 한 줄, 자동 검사 목록, N/A 불가 Gate는 요청 폼 대신 사유를 보인다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { gateKind, GateBadge } from '../design/status';
import { GateChecks, GateNaSection, GoNoGoBar } from '../screens/features/GateOutcomePanel';

afterEach(cleanup);
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );

describe('Gate 4상태·Go/No-Go (P10)', () => {
  it("'N/A'는 미판정이 아니라 해당 없음으로 보인다", () => {
    expect(gateKind('N/A')).toBe('NA');
    expect(gateKind(null)).toBe('UNJUDGED');
    render(<GateBadge status="N/A" />);
    expect(screen.getByText('해당 없음')).toBeTruthy();
  });

  it('No-Go면 FAIL Gate를, 판정 중이면 남은 Gate를 적는다', () => {
    const { rerender } = render(<GoNoGoBar v={{ result: 'NO_GO', required: ['G1', 'G2'], failed: ['G2'], open: [], notApplicable: ['G8'], passed: ['G1'] }} />);
    expect(screen.getByTestId('go-no-go').getAttribute('data-result')).toBe('NO_GO');
    expect(screen.getByTestId('go-no-go').textContent).toContain('FAIL: G2');
    expect(screen.getByTestId('go-no-go').textContent).toContain('해당 없음 1');
    rerender(<GoNoGoBar v={{ result: 'PENDING', required: ['G1', 'G2'], failed: [], open: ['G2'], notApplicable: [], passed: ['G1'] }} />);
    expect(screen.getByTestId('go-no-go').textContent).toContain('남은 판정: G2');
  });

  it('자동 검사 — 미충족 항목은 FAIL 표시와 부족한 것을 보인다', () => {
    render(<GateChecks checks={[{ gate: 'G4', key: 'KILL_READY', label: '긴급 차단 실행 가능(Flag 등록)', pass: false, detail: 'Flag Registry에 결속되지 않았거나 퇴역: x_00001_flag' }]} />);
    const li = screen.getByTestId('gate-checks').querySelector('li[data-check="KILL_READY"]')!;
    expect(li.getAttribute('data-state')).toBe('FAIL');
    expect(li.textContent).toContain('x_00001_flag');
  });

  it('G1·G4·G9는 해당 없음 요청 폼을 보이지 않고 사유를 보인다', () => {
    wrap(<GateNaSection id="FEAT-00001" ver="0.1.0" gate="G4" asil="QM" requests={[]} readOnly={false} />);
    expect(screen.queryByTestId('gate-na-request')).toBeNull();
    expect(screen.getByTestId('gate-na').textContent).toMatch(/해당 없음으로 둘 수 없습니다/);
  });

  it('승인 대기 요청이 있으면 새 요청 폼 대신 요청 내용을 보인다', () => {
    wrap(
      <GateNaSection
        id="FEAT-00001"
        ver="0.1.0"
        gate="G3"
        asil="QM"
        readOnly={false}
        requests={[{ requestId: 'GNA-00001', featureId: 'FEAT-00001', version: '0.1.0', gate: 'G3', reason: '공통 기능', status: 'PENDING', requestedBy: 'usr-safety', requestedRole: 'SAFETY_OFFICER', requestedAt: '2026-11-07T01:00:00.000Z', decidedBy: null, decidedRole: null, decidedAt: null, decisionReason: null, gateRecordId: null }]}
      />,
    );
    expect(screen.queryByTestId('gate-na-request')).toBeNull();
    expect(screen.getByTestId('gate-na').textContent).toContain('GNA-00001');
  });
});
