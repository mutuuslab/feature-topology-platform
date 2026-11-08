// 정적 데모(STATIC_MODE, 스냅샷만) — Feature DB 검색은 받아 둔 전체 목록에서 화면이 찾고(검색어 스냅샷이 없어 오류 상자가 떴다, 하네스 리뷰 F5),
// 등록 화면은 역할 규칙대로 안내 — 작성자에게 '작성자만 제안할 수 있습니다'가 보이던 결함(F6). 쓰기는 브라우저 안 시연 데이터(20-60).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { propose as P } from '../copy/propose';
import { featureDb as L } from '../copy/refdb';
import { ko } from '../copy/ko';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), STATIC_MODE: true }));

const { FeatureDbScreen } = await import('../screens/refdb/RefList');
const { default: ProposeScreen } = await import('../screens/home/propose/ProposeScreen');
const { searchLocally, STATIC_SEARCH_PAGE } = await import('../screens/refdb/refSearch');

const row = (refId: string, nameKo: string, aliases: string[] = [], status = 'ACTIVE') => ({ refId, nameKo, nameEn: `EN ${refId}`, aliases, status, domain: refId.startsWith('CH') ? 'Chassis & Vehicle Dynamics' : 'Autonomous Driving', component: 'X', asilRep: 'QM', tshirt: 'S' });
// 스냅샷 전체 목록 — 쪽 200개씩 두 쪽(250행). 오토 홀드(AVH)는 둘째 쪽에 있다(첫 쪽만 거르면 못 찾는다)
const ALL = [...Array.from({ length: 249 }, (_, i) => row(`AD-ADS-${String(i + 1).padStart(3, '0')}`, `자율 기능 ${i + 1}`)), row('CH-BRK-009', '오토 홀드', ['AVH'])];
let urls: string[];

beforeEach(() => {
  localStorage.clear();
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const u = new URL(url, 'http://x');
    let body: unknown = { items: [] };
    if (u.pathname.startsWith('/api/refdb/quality')) body = { total: ALL.length, byStatus: { ACTIVE: ALL.length }, statusMissing: 0, noSource: 0, evidenceStale: 0, sizeGradeDShare: 0, awaitingPublish: 0, latestRelease: 'v1.3' };
    if (u.pathname.startsWith('/api/refdb/refs')) {
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 50);
      body = { items: ALL.slice(offset, offset + limit), total: ALL.length, offset, limit, facets: { status: { ACTIVE: ALL.length } } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('정적 데모 — Feature DB 검색', () => {
  it('검색어를 넣으면 서버 q 대신 받아 둔 전체 목록(쪽 200)에서 찾는다 — 오류 상자 없음, 안내 한 줄', async () => {
    mount('viewer', '/master/feature-db', <FeatureDbScreen />);
    await screen.findByText('자율 기능 1');
    expect(screen.getByText(L.staticSearch)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: L.search }), { target: { value: 'AVH' } });
    expect(await screen.findByText('오토 홀드', {}, { timeout: 3000 })).toBeTruthy();
    expect(urls.some((u) => u.includes('q='))).toBe(false);
    expect(urls.filter((u) => u.includes(`limit=${STATIC_SEARCH_PAGE}`)).length).toBe(2);
    expect(document.querySelector('[data-state="error"]')).toBeNull();
  });

  it('등록 1단계 검색도 같다', async () => {
    mount('author', '/feature/propose', <ProposeScreen />);
    fireEvent.change(await screen.findByLabelText(/^기능 검색/), { target: { value: '오토' } });
    expect(await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(P.searchHintStatic)).toBeTruthy();
    expect(document.querySelector('[data-state="error"]')).toBeNull();
  });

  it('searchLocally — 순위(완전 > 앞부분 > 부분)·필터·상태 패싯', () => {
    const rows = [row('CH-BRK-010', '오토 홀드 해제'), row('CH-BRK-009', '오토 홀드', ['AVH']), row('CH-BRK-001', '제동', [], 'REVIEW')];
    expect(searchLocally(rows, { q: '오토홀드' }).items.map((r) => r.refId)).toEqual(['CH-BRK-009', 'CH-BRK-010']);
    expect(searchLocally(rows, { q: 'avh' }).items.map((r) => r.refId)).toEqual(['CH-BRK-009']);
    const r = searchLocally(rows, { status: 'REVIEW' });
    expect(r.items.map((x) => x.refId)).toEqual(['CH-BRK-001']);
    expect(r.facets!.status).toMatchObject({ ACTIVE: 2, REVIEW: 1 });
  });
});

describe('정적 데모 — 등록 화면은 브라우저 안 시연 데이터로 등록한다', () => {
  // 2026-11-06 — 공개 사이트의 쓰기는 브라우저 안 시연 데이터가 처리한다(20-60). 권한은 서버와 같은 역할 규칙 — 읽기 전용 안내 없음
  it("작성자에게는 등록 안내(읽기 전용 아님), 작성자가 아니면 '작성자만' 안내", async () => {
    mount('author', '/feature/propose', <ProposeScreen />);
    const btn = await screen.findByRole('button', { name: P.requestNew });
    expect(document.querySelector('[data-key-message] .ds-key__text')!.textContent).toBe(P.key.pick);
    expect(document.body.textContent).not.toContain(P.key.cannot);
    await waitFor(() => expect(btn).toHaveProperty('disabled', false));
    expect(document.body.textContent).not.toContain(ko.page.readOnly);
    cleanup();
    mount('viewer', '/feature/propose', <ProposeScreen />);
    await screen.findByRole('button', { name: P.requestNew });
    expect(document.querySelector('[data-key-message] .ds-key__text')!.textContent).toBe(P.key.cannot);
  });
});
