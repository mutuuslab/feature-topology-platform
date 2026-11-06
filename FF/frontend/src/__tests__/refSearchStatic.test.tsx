// 정적 데모 Feature DB 목록 — 스냅샷(tools/snapshot-api.ts)은 전체 목록의 쪽·상태 하나·도메인(·컴포넌트)의 첫 쪽만 저장한다.
// 도메인+상태 탭, 필터의 2쪽 이후는 파일이 없어 '데모에 없는 데이터' 오류 상자가 떴다(2026-11-06 하네스 리뷰).
// 저장된 모양이 아니면 받아 둔 전체 목록(쪽 200)에서 화면이 거르고 쪽을 나눈다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), STATIC_MODE: true }));

const { FeatureDbScreen } = await import('../screens/refdb/RefList');
const { staticSnapshotShape } = await import('../screens/refdb/refSearch');

const AD = 'Autonomous Driving';
const row = (i: number, status: string) => ({ refId: `AD-ADS-${String(i).padStart(3, '0')}`, nameKo: `자율 기능 ${i}`, nameEn: `EN ${i}`, aliases: [], status, domain: AD, component: 'X', asilRep: 'QM', tshirt: 'S' });
// 120행 — 짝수는 ACTIVE, 홀수는 REVIEW. 도메인 하나라 REVIEW 60행(2쪽)
const ALL = Array.from({ length: 120 }, (_, i) => row(i + 1, i % 2 ? 'REVIEW' : 'ACTIVE'));
let urls: string[];

/** 스냅샷처럼 — 저장된 모양(필터 없는 쪽·필터 하나의 첫 쪽)만 있고 나머지는 '스냅샷에 없음' 404 */
beforeEach(() => {
  localStorage.clear();
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const u = new URL(url, 'http://x');
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u.pathname.startsWith('/api/refdb/quality')) return json({ total: ALL.length, byStatus: { ACTIVE: 60, REVIEW: 60 }, statusMissing: 0, noSource: 0, evidenceStale: 0, sizeGradeDShare: 0, awaitingPublish: 0, latestRelease: 'v1.3' });
      if (u.pathname.startsWith('/api/refdb/refs')) {
        const filters = ['status', 'domain', 'component'].filter((k) => u.searchParams.get(k));
        const offset = Number(u.searchParams.get('offset') ?? 0);
        if ((filters.length && offset) || (filters.includes('status') && filters.length > 1)) return json({ error: { code: 'NOT_FOUND', message: '데모에 없는 데이터입니다' } }, 404);
        const status = u.searchParams.get('status');
        const rows = ALL.filter((r) => !status || r.status === status);
        const limit = Number(u.searchParams.get('limit') ?? 50);
        return json({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit, facets: { status: { ACTIVE: 60, REVIEW: 60 } } });
      }
      return json({ items: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer' }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/master/feature-db" element={<FeatureDbScreen />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('정적 데모 — Feature DB 목록, 스냅샷에 없는 필터 조합', () => {
  it('도메인 + 상태 탭은 받아 둔 전체 목록에서 거른다(오류 상자 없음)', async () => {
    mount(`/master/feature-db?domain=${encodeURIComponent(AD)}&status=REVIEW`);
    expect(await screen.findByText('자율 기능 2', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('자율 기능 1')).toBeNull();
    expect(document.querySelector('[data-state="error"]')).toBeNull();
  });

  it('상태 탭의 2쪽도 같다', async () => {
    mount('/master/feature-db?status=REVIEW&page=1');
    // REVIEW 60행 중 51번째 = 자율 기능 102
    expect(await screen.findByText('자율 기능 102', {}, { timeout: 3000 })).toBeTruthy();
    expect(document.querySelector('[data-state="error"]')).toBeNull();
  });

  it('저장된 모양 — 필터 없는 쪽, 필터 하나(또는 도메인+컴포넌트)의 첫 쪽만', () => {
    expect(staticSnapshotShape({ limit: 50 })).toBe(true);
    expect(staticSnapshotShape({ offset: 100, limit: 50 })).toBe(true);
    expect(staticSnapshotShape({ status: 'ACTIVE', limit: 50 })).toBe(true);
    expect(staticSnapshotShape({ domain: AD, component: 'X', limit: 50 })).toBe(true);
    expect(staticSnapshotShape({ domain: AD, status: 'REVIEW', limit: 50 })).toBe(false);
    expect(staticSnapshotShape({ status: 'ACTIVE', offset: 50, limit: 50 })).toBe(false);
    expect(staticSnapshotShape({ component: 'X', limit: 50 })).toBe(false);
    expect(staticSnapshotShape({ q: '오토', limit: 50 })).toBe(false);
    expect(staticSnapshotShape({ statuses: 'ACTIVE,REVIEW', limit: 50 })).toBe(false);
  });
});
