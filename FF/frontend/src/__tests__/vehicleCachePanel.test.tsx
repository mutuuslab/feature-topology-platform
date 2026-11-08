// 차량 정책 캐시 패널(P9) — 캐시 상태·유효 기간·쓴 캐시·위임 사유, 무결성 위반 표시(FR-SDM-002-002), 차량 쪽 차단 이력(FR-RTE-004-003)
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VehicleCachePanel, type VehicleCacheRow } from '../screens/ops/VehicleCachePanel';
import { vehicleCache as C } from '../copy/vehicle-cache';

afterEach(cleanup);

const row = (o: Partial<VehicleCacheRow>): VehicleCacheRow => ({ flagKey: 'care_00022_param', featureId: 'FEAT-00022', publicationId: 'PUB-00012', sequence: 3, validUntil: '2027-01-10T01:00:00.000Z', status: 'VALID', use: 'CURRENT', delegation: null, excluded: null, ...o });
const mount = (cache: VehicleCacheRow[], killHistory = [] as { at: string; publicationId: string; kind: string; result: string; detail: string }[]) =>
  render(
    <MemoryRouter>
      <VehicleCachePanel cache={cache} killHistory={killHistory} />
    </MemoryRouter>,
  );

describe('차량 정책 캐시 패널', () => {
  it('미검증 구형 캐시는 재취득 필요로 표시하며 정상 또는 무결성 위반으로 단정하지 않는다', () => {
    mount([row({ status: 'UNVERIFIED', use: 'SAFE_DEFAULT', delegation: 'CACHE_REACQUIRE_REQUIRED', excluded: 'CACHE_REACQUIRE_REQUIRED' })]);
    expect(screen.getByText('서명·기한 확인 필요')).toBeTruthy();
    expect(screen.getByText('서명된 정책과 유효 기간을 확인할 수 없습니다 — 정책을 다시 받으세요')).toBeTruthy();
    expect(screen.queryByText(C.ok)).toBeNull();
    expect(screen.getByRole('alert').textContent).not.toMatch(/무결성 위반/);
    expect(document.body.textContent).not.toContain('CACHE_');
  });

  it('만료·미수신 위임을 모든 캐시 정상으로 표시하지 않는다', () => {
    mount([row({ status: 'EXPIRED', use: 'SAFE_DEFAULT', delegation: 'CACHE_EXPIRED' }), row({ flagKey: 'missing_flag', status: null, use: 'SAFE_DEFAULT', delegation: 'CACHE_MISSING' })]);
    expect(screen.queryByText(C.ok)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('정상 캐시 — 상태·쓴 캐시를 보이고 무결성 위반 경고는 없다', () => {
    mount([row({})]);
    const panel = screen.getByText(C.title).closest('section') as HTMLElement;
    expect(within(panel).getByText(C.ok)).toBeTruthy();
    expect(within(panel).getByText(C.status.VALID)).toBeTruthy();
    expect(within(panel).getByText(C.use.CURRENT)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(C.killHistory)).toBeNull();
  });

  it('손상 캐시를 빼고 직전 캐시로, 만료는 안전 기본값 — 무결성 위반은 경고로 알리고 사유는 문장으로(코드 노출 없음)', () => {
    mount([row({ status: 'INTEGRITY_MISMATCH', use: 'PREVIOUS', excluded: 'CACHE_INTEGRITY_MISMATCH' }), row({ flagKey: 'care_00022_signal', status: 'EXPIRED', use: 'SAFE_DEFAULT', delegation: 'CACHE_EXPIRED' })]);
    expect(screen.getByRole('alert').textContent).toBe(C.integrityAlert(1));
    expect(screen.getByText(C.use.PREVIOUS)).toBeTruthy();
    expect(screen.getByText(C.use.SAFE_DEFAULT)).toBeTruthy();
    expect(screen.getByText(C.reason.CACHE_INTEGRITY_MISMATCH)).toBeTruthy();
    expect(screen.getByText(C.reason.CACHE_EXPIRED)).toBeTruthy();
    expect(document.body.textContent).not.toContain('CACHE_');
  });

  it('차량 쪽 차단 이력이 있으면 따로 보인다(최근 것이 위)', () => {
    mount([row({})], [
      { at: '2026-11-01T00:00:00.000Z', publicationId: 'PUB-00020', kind: 'KILL', result: 'APPLIED', detail: 'deactivate DC2 수락' },
      { at: '2026-11-02T00:00:00.000Z', publicationId: 'PUB-00021', kind: 'RESTORE', result: 'APPLIED', detail: 'restore DC2 수락' },
    ]);
    const panel = screen.getByText(C.killHistory, { selector: 'h2, h3, h4, [id$="-h"]' }).closest('section') as HTMLElement;
    const rows = within(panel).getAllByRole('row');
    expect(rows[1].textContent).toContain('PUB-00021');
  });
});
