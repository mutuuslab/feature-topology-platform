// Release Sign-off(출시 책임 확인) — 보고서 6.1 G7 승인자 Feature Owner의 개인 서명(사용자 결정 2026-10-18).
// Feature Owner(FEATURE_AUTHOR)만, G8·G9 PASS 뒤에만 서명한다. 다시 판정되면 이전 서명은 효력이 없다고 보인다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReleaseSignoffView } from '@ff/contracts';
import { AppProvider } from '../store';
import { ReleaseSignoffBar } from '../screens/features/ReleaseSignoff';

const SIGNED: ReleaseSignoffView['signoff'] = {
  featureId: 'FEAT-00001',
  version: '2.1.0',
  ownerId: 'Parking기획팀',
  signedBy: 'usr-author',
  signedRole: 'FEATURE_AUTHOR',
  signedAt: '2026-10-18T10:00:00+09:00',
  gateRecords: { G8: 'SIM-G8-000001', G9: 'SIM-G9-000001' },
  reason: '출시 책임 확인',
  kid: 'k1',
  sig: 'A'.repeat(86),
};

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let view: ReleaseSignoffView;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  view = { signoff: null, valid: false, stale: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'POST') view = { signoff: SIGNED, valid: true, stale: false };
      return new Response(JSON.stringify(view), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => (cleanup(), vi.unstubAllGlobals()));

function mount(role: string, gatesPassed = true) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>
          <ReleaseSignoffBar id="FEAT-00001" ver="2.1.0" gatesPassed={gatesPassed} />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const signBtn = () => screen.getAllByRole('button', { name: 'Release Sign-off — 개인 서명' })[0] as HTMLButtonElement;

describe('Release Sign-off (보고서 6.1 G7 — Feature Owner)', () => {
  it('Feature Owner는 G8·G9 PASS 뒤 사유를 적고 개인 서명한다', async () => {
    mount('author');
    expect(await screen.findByText(/아직 없습니다/)).toBeTruthy();
    expect(signBtn().disabled).toBe(false);
    fireEvent.click(signBtn());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SOTIF 출시 근거·Canary 기준 확인' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Release Sign-off — 개인 서명' }).at(-1)!); // 서랍 안의 서명 버튼
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/features/FEAT-00001/versions/2.1.0/release-signoff');
    expect(post.body).toEqual({ reason: 'SOTIF 출시 근거·Canary 기준 확인' });
    // 서명자는 이름·소속, 시각은 한국 시각 — 감사 탭과 같은 표기(W2 P1-5: UTC·usr-author로 보이던 결함)
    expect(await screen.findByText(/Release Sign-off 완료 — 김민영 \(.+\) · 2026-10-18 10:00/)).toBeTruthy();
    expect(screen.queryByText(/usr-author/)).toBeNull();
  });

  it('Feature Owner가 아닌 계정(품질 검토)은 서명할 수 없다', async () => {
    mount('quality');
    await screen.findByText(/아직 없습니다/);
    expect(signBtn().disabled).toBe(true);
  });

  it('G8·G9 PASS 전에는 서명 버튼이 잠긴다', async () => {
    mount('author', false);
    await screen.findByText(/아직 없습니다/);
    expect(signBtn().disabled).toBe(true);
    expect(signBtn().title).toBe('G8·G9 PASS 뒤에 서명할 수 있습니다');
  });

  it('다시 판정되어 효력이 없는 서명은 그렇다고 보이고 다시 서명하게 한다', async () => {
    view = { signoff: SIGNED, valid: false, stale: true };
    mount('author');
    expect(await screen.findByText(/효력이 없습니다/)).toBeTruthy();
    expect(signBtn().disabled).toBe(false);
  });
});

describe('Release Sign-off — 폐기 예정·폐기 기준 행 경고(막지 않음, 사용자 결정 2026-11-04 #9)', () => {
  it('서명 응답의 warnings를 서명 뒤 막대 아래에 대체 행 링크와 함께 보인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === 'POST') view = { signoff: SIGNED, valid: true, stale: false };
        const warnings = [{ code: 'REF_STATUS', refId: 'PL-CP-023', status: 'DEPRECATED', replacedBy: 'PL-CP-030', message: '기준 행 PL-CP-023은(는) 폐기 예정 상태입니다. 서명은 막지 않습니다 — 다음 Version에서 대체 행으로 다시 연결하세요.' }];
        return new Response(JSON.stringify(method === 'POST' ? { ...view, warnings } : view), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    mount('author');
    await screen.findByText(/아직 없습니다/);
    fireEvent.click(signBtn());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '출시 근거 확인' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Release Sign-off — 개인 서명' }).at(-1)!);
    const box = await screen.findByTestId('ref-warnings');
    expect(box.getAttribute('role')).toBe('status');
    expect(box.textContent).toContain('PL-CP-023');
    expect(box.querySelector('[data-replaced-by="PL-CP-030"] a')!.getAttribute('href')).toBe('/master/feature-db/PL-CP-030');
  });
});
