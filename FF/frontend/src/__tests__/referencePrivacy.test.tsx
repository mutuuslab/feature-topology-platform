// 고객 기준 값(RD-OPS-03)·개인정보 탭(RD-P2-05) 화면 — 모의 API.
//  · 기준 값: 종류별 표, 빈 설치는 빈 상태 안내, 지역·트림은 상위 값을 골라야 등록, 사용 중지는 부모를 본문에 싣는다
//  · 체험권 목록의 판매국 선택지는 등록된 기준 값에서 온다(데모 목록 아님), 출처 선택은 '등록 차량'(FLEET)
//  · 개인정보: 목록·보존 기한(결정 대기 표시), 내보내기는 보안 담당자만, 요청 목록은 보안 담당자·감사 조회자만 조회
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PERSONAL_DATA_INVENTORY, PERSONAL_RETENTION } from '@ff/contracts';
import { AppProvider } from '../store';
import { ReferenceValuesScreen } from '../screens/master/ReferenceValues';
import { DataGovernanceScreen } from '../screens/admin/DataGovernance';
import { EntitlementsScreen } from '../screens/policy/Entitlements';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path.split('?')[0]} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const V = (kind: string, code: string, parent: string | null = null, o: object = {}) => ({ kind, code, label: code, parent, origin: 'CUSTOMER', status: 'ACTIVE', createdAt: '2026-10-25T00:00:00.000Z', createdBy: 'usr-variant', ...o });
const VALUES = [V('COUNTRY', 'JP'), V('COUNTRY', 'KR', null, { origin: 'SEED' }), V('REGION', 'Kanto', 'JP'), V('VEHICLE_MODEL', 'NE1'), V('TRIM', 'Base', 'NE1')];

describe('차종·판매국 기준 값 (RD-OPS-03)', () => {
  it('빈 설치 — 빈 상태 안내(데모 값 없음)', async () => {
    handler = () => ({ body: { items: [], kinds: ['COUNTRY', 'REGION', 'VEHICLE_MODEL', 'TRIM'] } });
    mount('steward', '/master/reference-values', <ReferenceValuesScreen />);
    expect(await screen.findByText('등록된 기준 값이 없습니다 — 판매국과 차종부터 등록하세요.')).toBeTruthy();
  });

  it('종류별 표와 출처(데모 시드·고객 등록), 트림은 상위 차종을 골라야 등록한다', async () => {
    handler = (url, init) => {
      if (url.startsWith('/api/reference-values') && init?.method === 'POST') return { status: 201, body: V('TRIM', 'GT', 'NE1') };
      if (url.startsWith('/api/reference-values')) return { body: { items: VALUES } };
    };
    mount('steward', '/master/reference-values', <ReferenceValuesScreen />);
    const country = await screen.findByRole('table', { name: '판매국' });
    expect(within(country).getByText('데모 시드')).toBeTruthy();
    expect(within(country).getByText('고객 등록')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'TRIM' } });
    fireEvent.change(screen.getByLabelText('코드'), { target: { value: 'GT' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'GT' } });
    const submit = screen.getByRole('button', { name: '등록' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('상위 값 · 차종'), { target: { value: 'NE1' } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ kind: 'TRIM', code: 'GT', label: 'GT', parent: 'NE1' });
  });

  it('사용 중지 — 상위 값이 있는 값은 부모를 본문에 싣는다', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { body: V('REGION', 'Kanto', 'JP', { status: 'RETIRED' }) };
      if (url.startsWith('/api/reference-values')) return { body: { items: VALUES } };
    };
    mount('steward', '/master/reference-values', <ReferenceValuesScreen />);
    await screen.findByRole('table', { name: '지역' });
    fireEvent.change(screen.getByLabelText('중지할 값'), { target: { value: 'REGION|JP|Kanto' } });
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '시장 철수' } });
    fireEvent.click(screen.getByRole('button', { name: '사용 중지' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain('/api/reference-values/REGION/Kanto/retire');
    expect(post.body).toEqual({ reason: '시장 철수', parent: 'JP' });
  });

  it('체험권 목록의 판매국 선택지는 등록된 기준 값 — 데모 목록(US·EU)이 아니다, 출처는 등록 차량(FLEET)', async () => {
    handler = (url) => {
      if (url.startsWith('/api/reference-values')) return { body: { items: VALUES } };
      if (url.startsWith('/api/trials')) return { body: { today: '2026-10-25', total: 0, page: 1, pageSize: 50, byState: {}, items: [] } };
    };
    mount('operator', '/entitlements', <EntitlementsScreen />);
    const country = (await screen.findByLabelText('국가')) as HTMLSelectElement;
    await waitFor(() => expect([...country.options].map((o) => o.value)).toEqual(['', 'JP', 'KR']));
    expect(screen.getByRole('radio', { name: '등록 차량' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '등록 차량' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('source=FLEET'))).toBe(true));
  });
});

describe('개인정보 탭 (RD-P2-05)', () => {
  const INV = { stores: PERSONAL_DATA_INVENTORY, retention: PERSONAL_RETENTION.map((p) => ({ ...p, days: p.defaultDays })), lake: { configured: false } };
  const REQ = { requestId: 'PRV-00001', subjectKind: 'USER', subjectId: 'usr-leaver', pseudonym: 'psn-0123456789abcdef', basis: 'EMPLOYMENT_END', reason: '퇴직', status: 'REQUESTED', requestedBy: 'usr-csm', requestedAt: '2026-10-25T00:00:00.000Z', decidedBy: null, decidedAt: null, decisionReason: null, preview: { dashboard: 1 }, result: null };

  const open = async (role: string) => {
    mount(role, '/admin/data', <DataGovernanceScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: '개인정보' }));
  };

  it('목록·보존 기한 — 처리 방법과 결정 대기(D-RD-9)를 보이고, 내보내기는 보안 담당자만', async () => {
    handler = (url) => {
      if (url.startsWith('/api/privacy/inventory')) return { body: INV };
      if (url.startsWith('/api/privacy/requests')) return { body: { items: [REQ] } };
    };
    await open('integrator');
    const table = await screen.findByRole('table', { name: '개인정보 목록' });
    expect(within(table).getAllByText('법정 보존(열람만)').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('가명 처리').length).toBeGreaterThan(0);
    expect(await screen.findByText(/사용자 결정 대기 D-RD-9/)).toBeTruthy();
    expect(screen.getByRole('table', { name: '삭제·가명 처리 요청' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('식별자(사용자 sub 또는 VIN)'), { target: { value: 'usr-leaver' } });
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '본인 열람 요청' } });
    const exp = screen.getByRole('button', { name: '내보내기(JSON)' }) as HTMLButtonElement;
    expect(exp.disabled).toBe(false);
  });

  it('보안 담당자·감사 조회자가 아니면 요청 목록을 조회하지 않고 안내만 — 내보내기도 막힌다', async () => {
    handler = (url) => (url.startsWith('/api/privacy/inventory') ? { body: INV } : undefined);
    await open('author');
    expect(await screen.findByText('보안 담당자·감사 조회자만 요청 목록을 봅니다.')).toBeTruthy();
    expect(calls.some((c) => c.url.startsWith('/api/privacy/requests'))).toBe(false);
    fireEvent.change(screen.getByLabelText('식별자(사용자 sub 또는 VIN)'), { target: { value: 'usr-leaver' } });
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '본인 열람 요청' } });
    expect((screen.getByRole('button', { name: '내보내기(JSON)' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
