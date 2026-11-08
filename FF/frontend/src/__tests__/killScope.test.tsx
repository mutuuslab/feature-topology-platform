// 차단 대상 범위 패널(P11a, FR-KSW-001-002·002-003·003-001) — 범위 칸을 고르면 맞는 차량만, 영향 그룹·Variant 조건 표시
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { KillParties, KillScopePanel, scopedRows } from '../screens/ops/KillScopePanel';
import type { KillScopeFilter } from '../../../contracts/src/rules/kill-scope';

afterEach(cleanup);
const ROWS = [
  { vin: 'V1', country: 'KR', vehicleModel: 'NX4', trim: 'Prestige', upgVc: 'UPG-1', swVersion: '1.2.1', verdict: 'APPLICABLE' },
  { vin: 'V2', country: 'KR', vehicleModel: 'NX4', trim: 'Prestige', upgVc: 'UPG-1', swVersion: '1.2.1', verdict: 'APPLICABLE' },
  { vin: 'V3', country: 'KR', vehicleModel: 'NX4', trim: 'Prestige', upgVc: 'UPG-1', swVersion: '1.1.0', verdict: 'NOT_SUPPORTED' },
];
function Host() {
  const [scope, setScope] = useState<KillScopeFilter>({});
  return (
    <>
      <KillScopePanel rows={ROWS} rule={{ country: 'KR', vehicleModel: 'NX4', trim: 'Prestige', upgVc: ['UPG-1'], requiredSw: '1.2.1' }} scope={scope} onScope={setScope} />
      <output data-testid="kept">{scopedRows(ROWS, scope).map((r) => r.vin).join(',')}</output>
    </>
  );
}

describe('차단 대상 범위 패널', () => {
  it('고르지 않으면 전체, SW 버전을 고르면 그 버전 차량만 — 영향 그룹이 범위 유형별로 묶인다', () => {
    render(<Host />);
    expect(screen.getByTestId('kept').textContent).toBe('V1,V2,V3');
    const panel = screen.getByTestId('kill-scope');
    expect(within(panel).getAllByRole('row')).toHaveLength(3); // 머리 + 그룹 2
    expect(screen.getByTestId('kill-variant-rule').textContent).toContain('요구 SW 1.2.1');
    fireEvent.change(within(panel).getByLabelText('SW 버전'), { target: { value: '1.1.0' } });
    expect(screen.getByTestId('kept').textContent).toBe('V3');
    expect(panel.textContent).toContain('SW 미지원 1');
    fireEvent.change(within(panel).getByLabelText('SW 버전'), { target: { value: '' } });
    expect(screen.getByTestId('kept').textContent).toBe('V1,V2,V3');
  });
});

describe('관련 담당자', () => {
  it('Owner·요청자·승인자·협력사(SW 납품 정보)를 한 표로', () => {
    render(<KillParties p={{ owner: 'TEAM-ADAS', requester: 'usr-ops', approvers: ['usr-safety', 'usr-csm'], suppliers: [{ supplier: 'Mutuus Lab', swId: 'SW-A', version: '1.2.1' }] }} person={(id) => `[${id}]`} />);
    const t = screen.getByRole('table');
    expect(t.textContent).toContain('TEAM-ADAS');
    expect(t.textContent).toContain('[usr-ops]');
    expect(t.textContent).toContain('[usr-safety], [usr-csm]');
    expect(t.textContent).toContain('Mutuus Lab · SW-A 1.2.1');
  });
});
