// 26580 하네스 리뷰(2026-11-06) 회귀 — 자동 채움 이력(누가·언제·그대로/고침/직접 입력, 내부 규칙 이름 안 보임),
// 등록 현황·위반 상자에 '없음'만 남지 않음, 구성 승인 막힘(D-26580-2) 버튼 사유. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { FeatureProfilePanel } from '../screens/ple/FeatureProfilePanel';
import { RegistrationsTable } from '../screens/ple/Registrations';
import { IssueList } from '../screens/ple/PleScreens';
import { ProductDetail } from '../screens/products/Products';
import { autofill as A, bof as B, profile as PR } from '../copy/ple';

type Reply = { status?: number; body?: unknown } | undefined;
let handler: (url: string) => Reply;

beforeEach(() => {
  localStorage.clear();
  handler = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const r = handler(url) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (el: JSX.Element, role = 'author', path = '/x', routePath = '/x') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={routePath} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const CODE = /\b[A-Z]{3,}_[A-Z_]+\b/;
const why = (btn: HTMLElement) => document.getElementById(btn.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

describe('Feature 상세 — 자동 채움 이력', () => {
  it('칸마다 누가·언제·그대로/고침/직접 입력, 출처에 내부 규칙 이름이 보이지 않는다(옛 기록 포함)', async () => {
    const V = { catalogueRole: 'PRIMARY', parentRefId: null, featureType: 'BOOLEAN', variability: 'OPTIONAL', bindingTime: 'RUNTIME_FLAG', variationPoints: [] };
    const row = (id: number, field: string, decision: string, sourceRef: string | null, final: unknown) => ({ id, featureId: 'FEAT-00999', version: '0.1.0', field, sourceKind: sourceRef ? 'RULE' : null, sourceRef, suggested: null, final, decision, actorId: 'kim.author', at: '2026-11-06T01:00:00.000Z' });
    handler = (u) =>
      u.startsWith('/api/features/FEAT-00999/versions/0.1.0/variability')
        ? { body: { variability: V, source: 'AUTO', updatedBy: 'kim.author', history: [row(1, 'asil', 'ACCEPTED', 'BC-SEAT-001 · 대표 ASIL(L)', 'QM'), row(2, 'owner', 'ADDED', null, '바디상품기획팀'), row(3, 'variability', 'EDITED', 'VARIABILITY_PROPOSAL · 26580 변이 프로필 제안', V), row(4, 'controlPoints', 'ACCEPTED', 'CONTROL_POINT_PLAN · Flag: 런타임 켬/끔', ['Flag'])] } }
        : undefined;
    wrap(<FeatureProfilePanel featureId="FEAT-00999" version="0.1.0" />);
    const table = await screen.findByRole('table', { name: A.title });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('[data-ref-mark]')?.textContent)).toEqual([A.state.base, A.state.added, A.state.edited, A.state.base]);
    expect(table.textContent).toContain('2026-11-06 10:00'); // 언제(한국 시각)
    expect(table.textContent).not.toMatch(CODE);
    expect(table.textContent).toContain('26580 변이 프로필 제안');
    expect(table.textContent).toContain('BC-SEAT-001 · 대표 ASIL(L)');
  });
});

// 통합 12단계 — 기준 행이 없는 Feature(FEAT-00022 등)는 프로필이 없어 패널이 빈 상자로 남았다(정적 하네스 '숨은 빈 목록') — 패널을 그리지 않는다
describe('Feature 상세 — 프로필이 없는 Version', () => {
  it('프로필·이력이 없으면 패널을 그리지 않는다', async () => {
    let asked = false;
    handler = (u) => (u.startsWith('/api/features/FEAT-00998/versions/1.0.0/variability') ? ((asked = true), { body: { featureId: 'FEAT-00998', version: '1.0.0', variability: null, source: null, updatedBy: null, updatedAt: null, history: [] } }) : undefined);
    const { container } = wrap(<FeatureProfilePanel featureId="FEAT-00998" version="1.0.0" />);
    // 불러오는 동안은 패널(자리 표시)이 있다가, 프로필이 없다고 오면 사라진다
    await vi.waitFor(() => expect(asked && !container.querySelector('#feature-profile-h')).toBe(true));
    expect(screen.queryByText(PR.title)).toBeNull();
  });
});

describe("등록 현황·위반 상자 — '없음'만 남지 않는다", () => {
  it('대표 행·승인 전 칸·자동 채움이 비어도 무엇인지 말한다', () => {
    wrap(<RegistrationsTable rows={[{ featureId: 'FEAT-00010', version: '0.2.0', name: '이어 만든 Version', primaryRef: null, missing: [], autofill: null, stageIndex: 2 }, { featureId: 'FEAT-00011', version: '0.1.0', name: '옛 등록', primaryRef: { refId: 'BC-SEAT-001', nameKo: '전동 시트' }, missing: [], autofill: null, stageIndex: 2 }]} />);
    const t = screen.getByRole('table');
    expect(t.textContent).not.toContain('없음');
    expect(t.textContent).toContain('모두 채움');
  });
  it('위반이 없는 상품은 지킨 제약을 숫자로 보인다', () => {
    render(<IssueList issues={[]} checked={4} />);
    expect(document.body.textContent).not.toMatch(/없습니다|없음/);
    expect(document.body.textContent).toContain(B.issuesNone(4));
  });
});

describe('상품 — 구성 승인 막힘(D-26580-2)', () => {
  it('카탈로그 제약 위반이 있으면 구성 승인 단추가 막히고 사유 문장이 보인다', async () => {
    const sentence = '카탈로그 제약 위반 1건 — 고친 뒤 구성 승인하세요: FEAT-00004(AD-LAT-011)는 기준 행 AD-LAT-004를 선행으로 필요로 하는데 상품에 없습니다.';
    const P = { catalogId: 'CAT-00099', version: '1.0.0', name: 'P', description: 'd', country: 'KR', vehicleModel: 'GN7', trim: 'Calligraphy', tags: [], saleType: '체험', type: 'PACKAGE', baselineIds: ['BL-00008'], validFrom: '2026-10-01', validTo: '2026-12-31', ownerId: '팀', lifecycle: 'PROPOSED' };
    handler = (u) =>
      u.startsWith('/api/products/CAT-00099/versions/1.0.0')
        ? { body: { product: P, meta: { createdBy: 'usr-commerce', configApprovedBy: null, releaseApprovedBy: null }, composition: { result: 'PASS', issues: [], features: [] }, eligibility: { eligible: false, reasons: [] }, transitions: [{ to: 'APPROVED', ko: '구성 승인', approval: 'CONFIG', blockers: [sentence] }], versions: [{ version: '1.0.0', lifecycle: 'PROPOSED' }] } }
        : undefined;
    wrap(<ProductDetail />, 'approver', '/products/CAT-00099/1.0.0', '/products/:id/:ver');
    const btn = await screen.findByRole('button', { name: '구성 승인 → APPROVED' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(why(btn)).toBe(sentence);
  });
});
