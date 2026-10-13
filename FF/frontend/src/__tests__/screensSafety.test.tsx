// 안전 분류 Registry(WP1) 화면 — 보고서 v1.1 5장. 조합 검사(FFG-CLS-009·TC-FF-23)는 화면과 서버가 같은 contracts 함수로 판정하고,
// 확정(FFG-CLS-001)은 Safety Manager만, 확정 뒤에는 잠긴다(FFG-CLS-004).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { checkProfile, type SafetyProfile } from '@ff/contracts';
import { AppProvider } from '../store';
import { SafetyTab } from '../screens/features/SafetyTab';

// 데이터셋 추정 초안(FEAT-00001@2.1.0)과 같은 모양 — F2 · DC2 · R1, 조합 위반 없음
const BASE: SafetyProfile = { featureId: 'FEAT-00099', version: '0.1.0', status: 'DRAFT', source: 'INFERRED', fClass: 'F2', deactClass: 'DC2', regClass: 'R1', flagType: 'OPS', adsFeature: false, adsfType: null, gsrMandatory: false, itemIds: [], haraRef: null, asilRef: 'B', safetyGoalIds: [], safeState: 'BASE_ONLY', endState: 'DISABLED', takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, faultTolerantTimeMs: 5000, maxPendingMs: 0, maxCycleWaitMs: 28800000, maxActivationScope: { vehicles: 50000, perWindow: 5000 }, markets: ['KR'], rxswin: [], approvalProfile: null, evidenceManifestId: null, sbomRef: null, rollbackTarget: null, expiresAt: null, retirementPlan: null, confirmedBy: null, confirmedAt: null, confirmSig: null };

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let profile: SafetyProfile;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  profile = { ...BASE };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (method === 'PUT') profile = { ...profile, ...(body as Partial<SafetyProfile>) };
      if (method === 'POST') profile = { ...profile, status: 'CONFIRMED', confirmedBy: 'usr-safety', confirmedAt: '2026-10-13T00:00:00Z', confirmSig: 'A'.repeat(86) };
      return new Response(JSON.stringify({ profile, findings: checkProfile(profile) }), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => (cleanup(), vi.unstubAllGlobals()));

function mount(role: string) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/features/FEAT-00099/0.1.0']}>
        <AppProvider>
          <Routes>
            <Route path="/features/:id/:ver" element={<SafetyTab id="FEAT-00099" ver="0.1.0" />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const confirmBtn = () => screen.getAllByRole('button', { name: '확정 — 개인 서명' })[0] as HTMLButtonElement;

describe('안전 분류 탭 — 조합 검사 (FFG-CLS-009 · TC-FF-23)', () => {
  it('F2에 DC0을 고르면 곧바로 위반이 보이고 확정이 막힌다 — 서버와 같은 규칙 ID', async () => {
    mount('quality');
    const dc = (await screen.findByLabelText('비활성화 등급 DC')) as HTMLSelectElement;
    expect(screen.getByText('조합 위반 없음')).toBeTruthy();
    fireEvent.change(dc, { target: { value: 'DC0' } });
    const panel = screen.getByText('조합 검사 (FFG-CLS-009 외)', { selector: 'h2, h3, .ds-panel__title' }).closest('section')!;
    expect(within(panel).getByText('FFG-CLS-009')).toBeTruthy();
    expect(within(panel).getByText('위반 1건')).toBeTruthy();
    expect(confirmBtn().disabled).toBe(true);
    expect(screen.getByText('저장하지 않은 변경이 있습니다')).toBeTruthy();
  });

  it('DC2 미리보기는 경고 → 인계(4초) → 효과 감소 순서', async () => {
    mount('author');
    const preview = (await screen.findByText('비활성화 효과 미리보기')).closest('section')!;
    expect(preview.textContent).toContain('4.0 s');
    expect(within(preview).getByRole('list', { name: '안전·보안·법규 사유' }).textContent).toMatch(/운전자 경고.*4.0 s/);
  });
});

describe('안전 분류 탭 — 저장·확정 권한 (FFG-CLS-001 · FFG-CLS-004)', () => {
  it('작성자는 초안을 저장하되 확정은 못 한다 — 바뀐 항목만 보낸다', async () => {
    mount('author');
    fireEvent.change(await screen.findByLabelText('법규 등급 R'), { target: { value: 'R0' } });
    fireEvent.click(screen.getByRole('button', { name: '초안 저장' }));
    await vi.waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/features/FEAT-00099/versions/0.1.0/safety');
    expect(put.body).toEqual({ regClass: 'R0' });
    expect(confirmBtn().disabled).toBe(true);
  });

  it('Safety Manager가 사유를 적어 확정하면 잠기고 개인 서명이 보인다', async () => {
    mount('quality');
    await screen.findByLabelText('처리강도 F');
    fireEvent.click(confirmBtn());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'HARA 검토 완료' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '확정 — 개인 서명' }));
    expect(await screen.findByText('확정된 분류입니다 — 바꾸려면 새 Version을 만드세요 (FFG-CLS-004)')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ reason: 'HARA 검토 완료' });
    expect(screen.getByLabelText('처리강도 F').matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: '초안 저장' })).toBeNull();
    expect(screen.getByText(`${'A'.repeat(16)}…`)).toBeTruthy();
  });
});
