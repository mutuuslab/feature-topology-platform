// 회귀: 3초 테스트 잔여 UX3-01·02·06·07 (2026-10-23 하네스 3판)
// - UX3-01 본문(설명 모드 꺼짐)에 규칙·컴포넌트 코드(FFG-*·D0x-xx·IF-xx·CS-01)가 보이면 안 된다 — 코드는 설명 모드(.ds-explain)·툴팁으로
// - UX3-02 감사: 허용 행은 배지 대신 작은 표시, 역할은 한글 라벨, 필터와 결과 열은 같은 낱말
// - UX3-06 정책 상세: H1은 Feature 이름 + 제어점(flagKey는 meta), 미검증이면 핵심 메시지 행동이 '분야별 검증 실행', 가상검증은 보조 버튼
// - UX3-07 따라하기 허브: 시작 버튼은 보조, '준비 중'은 한 묶음 + SummaryLine 개수
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { reportRule, TUTORIALS } from '@ff/contracts';
import { AppProvider } from '../store';
import { RuleChecklist, RuleText } from '../design';
import { ComplianceScreen } from '../screens/master/Ops';
import { AuditScreen } from '../screens/governance/AuditEvents';
import { PolicyDetail } from '../screens/policy/Policies';
import { LearnHub } from '../screens/learn/Learn';

/** e2e three-second.spec ⑨와 같은 뜻의 코드 식 */
const CODE = /FFG-[A-Z]+-\d|\bIF-\d|\bD0\d-\d|보고서 \d|§\d|\bCS-\d|\bCLASSIFY-GATE\b|\bKILL-DC\d/;

/** 설명 모드를 끈 화면의 글자 — 설명 모드 전용 요소를 빼고 읽는다 */
function visibleText(root: Element = document.body): string {
  const c = root.cloneNode(true) as Element;
  c.querySelectorAll('.ds-explain, .ds-explain-block, .ds-page__codes').forEach((e) => e.remove());
  return c.textContent ?? '';
}

type Handler = (url: string, init?: RequestInit) => unknown;
let handler: Handler;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return new Response(JSON.stringify(body ?? { error: { code: 'NOT_FOUND', message: url } }), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, route: string, el: JSX.Element, role = 'author') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={route} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('UX3-01 본문에 규칙 코드 없음 — 설명 모드에서만', () => {
  it('규칙 판정 목록: 제목을 알면 ID는 설명 모드, 제목 툴팁에 ID', () => {
    const { container } = render(<RuleChecklist items={[{ id: 'FFG-PLT-005', status: 'pending', reason: '서로 다른 2인 승인 대기' }]} />);
    const id = container.querySelector('.ds-rules__id')!;
    expect(id.closest('.ds-explain'), 'ID는 설명 모드 칩 안').toBeTruthy();
    const title = container.querySelector('.ds-rules__title')!;
    expect(title.textContent).toBe(reportRule('FFG-PLT-005')!.title);
    expect(title.getAttribute('title')).toBe('FFG-PLT-005');
    expect(visibleText(container)).not.toMatch(CODE);
  });

  it('규칙 판정 목록: 카탈로그에 제목이 없는 ID는 그대로 보인다(빈 줄이 되지 않게)', () => {
    // 카탈로그에 없는 ID를 일부러 만든다 — 소스 글자로 쓰면 standards 검사(ID 실재)가 막는다
    const unknownId = ['FFG', 'XXX', '999'].join('-');
    const { container } = render(<RuleChecklist items={[{ id: unknownId, status: 'fail' }]} />);
    expect(container.querySelector('.ds-rules__id')!.closest('.ds-explain')).toBeNull();
  });

  it('문장 끝 괄호 ID·절 번호는 설명 모드로 — 문장은 남는다', () => {
    const { container } = render(
      <p>
        <RuleText text="운영자가 고르지 않습니다 (FFG-PLT-003)" explain /> · <RuleText text="리콜 근거가 필요합니다 (FFG-PLT-009·FFG-DEAC-010)" explain /> ·{' '}
        <RuleText text="캠페인 100대(보고서 6.3.1)" explain /> · <RuleText text="수집기에 (IF-11)" explain /> · <RuleText text="기준값 19.11 s (보고서 CS-01) — 차이" explain /> ·{' '}
        <RuleText text="FFG-CLS-006: 실험할 수 없습니다" explain />
      </p>,
    );
    const text = visibleText(container);
    expect(text).not.toMatch(CODE);
    expect(text).toContain('운영자가 고르지 않습니다');
    expect(text).toContain('캠페인 100대');
    expect(container.querySelector('[data-explain-rules="FFG-PLT-009 FFG-DEAC-010"]')).toBeTruthy();
  });

  it('컴플라이언스 규칙 표: 규칙은 제목, 컴포넌트는 이름 — ID는 설명 모드', () => {
    mount('/verify/compliance', '/verify/compliance', <ComplianceScreen />);
    const table = screen.getByRole('table');
    expect(visibleText(table)).not.toMatch(CODE);
    expect(table.querySelector('[data-explain-rules]'), '추적성 — 규칙 칩은 설명 모드에 있다').toBeTruthy();
    expect(within(table).getAllByText('Feature Registry').length).toBeGreaterThan(0);
  });
});

const AUDIT = [
  { id: 1, at: '2026-10-12T01:00:00.000Z', actorId: 'kim', actorRole: 'FEATURE_AUTHOR', action: 'POLICY_CREATE', target: 'POL-00001', result: 'ALLOWED', reason: null },
  { id: 2, at: '2026-10-12T01:01:00.000Z', actorId: 'lee', actorRole: 'OPERATOR', action: 'POLICY_APPROVE', target: 'POL-00001', result: 'DENIED', reason: 'FFG-CLS-006: F3 Feature는 A/B 실험을 할 수 없습니다' },
];

describe('UX3-02 감사 — 예외만 배지, 역할 한글, 필터·결과 같은 낱말', () => {
  it('허용 행은 작은 표시, 거부만 배지 · 역할 enum은 한글 라벨', async () => {
    handler = (u) => (u.startsWith('/api/audit/chain') ? { ok: true, verified: 2, head: 'h', broken: null } : u.startsWith('/api/audit') ? { items: AUDIT } : undefined);
    mount('/audit', '/audit', <AuditScreen />);
    const table = await screen.findByRole('table');
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBe(2));
    const [allowed, denied] = [...table.querySelectorAll('tbody tr')];
    expect(allowed.querySelector('.ds-badge'), '허용은 배지가 아니다').toBeNull();
    expect(allowed.querySelector('.ds-done[role="img"][aria-label="허용"]'), '작은 표시도 접근 이름이 있다(axe aria-prohibited-attr)').toBeTruthy();
    // 서버 사유 앞의 규칙 ID는 설명 모드로 — 사유 문장은 남는다(e2e ⑨에서 발견)
    expect(visibleText(denied)).not.toMatch(CODE);
    expect(visibleText(denied)).toContain('A/B 실험을 할 수 없습니다');
    expect(denied.querySelector('.ds-badge')?.textContent).toContain('거부');
    expect(table.textContent).not.toMatch(/FEATURE_AUTHOR|OPERATOR/);
    expect(allowed.textContent).toContain('Feature 작성자');
    // 필터 낱말 = 결과 열 낱말
    const radios = screen.getAllByRole('radio').map((r) => r.textContent ?? '');
    expect(radios.join(' ')).toContain('거부');
    expect(radios.join(' ')).not.toMatch(/ALLOWED|DENIED|FAILED/);
  });
});

const POL = {
  policyId: 'POL-00003', revision: 2, status: 'VALIDATED', featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: 'care_00022_signal',
  description: '정책', enabled: true, safeDefault: false, entitlementCatalogId: null, rollout: { mode: 'ALL', basisPoints: 10000, salt: 'S' }, stageBasisPoints: null,
  contentHash: 'sha256:aa', createdBy: 'usr-author', createdAt: '2026-10-01T00:00:00.000Z', approvedBy: null, approvedAt: null,
};
const RUN = { runId: 'VR-00001', policyId: 'POL-00003', policyRevision: 1, decision: 'GO', reasons: [], at: '2026-10-02T00:00:00.000Z', by: 'u', results: [{ componentId: 'D06-03', ko: '차량 시나리오', result: 'PASS', summary: '요약', findings: [] }] };
const SCN = { scenarioId: 'SCN-FEAT00022-NOMINAL', validator: 'D06-03', role: 'NOMINAL', name: 'n', purpose: 'p', params: {} };
const detail = (over: Record<string, unknown>) => ({ policy: POL, feature: { name: '전방 안전거리 3단계', asil: 'B' }, hashMatchesValidation: false, lastRun: RUN, runs: [RUN], approval: { eligible: false, reasons: [] }, ...over });
const policyHandler = (d: unknown) => (u: string) =>
  u.startsWith('/api/virtual-validations/scenarios') ? { items: [SCN] } : u.startsWith('/api/virtual-validations') ? { items: [] } : u.startsWith('/api/policies/POL-00003') && !u.includes('/', '/api/policies/POL-00003'.length) ? d : u.includes('/revisions') ? { current: 2, items: [] } : { items: [] };

describe('UX3-06 정책 상세 — 제목·핵심 행동·보조 버튼', () => {
  it('H1은 Feature 이름 + 제어점, flagKey는 meta의 ID 칩', async () => {
    handler = policyHandler(detail({}));
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />);
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('전방 안전거리 3단계 — 신호 제어점');
    expect(document.querySelector('.ds-page__meta [data-id="care_00022_signal"]')).toBeTruthy();
  });

  it('검증이 낡았고 작성 권한이 있으면 핵심 메시지 행동이 분야별 검증 — 머리 버튼은 되풀이하지 않는다', async () => {
    handler = policyHandler(detail({}));
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />, 'author');
    await screen.findByRole('heading', { level: 1 });
    const key = document.querySelector('[data-key-message]') as HTMLElement;
    expect(within(key).getByRole('button', { name: '분야별 검증 실행' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '분야별 검증 실행' })).toHaveLength(1);
  });

  it('작성 권한이 없으면 핵심 메시지에 행동이 없다(머리의 막힌 버튼과 사유만)', async () => {
    handler = policyHandler(detail({}));
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />, 'viewer');
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('[data-key-message] button')).toBeNull();
  });

  it('가상검증 실행은 보조 버튼, 시나리오의 검증 컴포넌트는 이름으로', async () => {
    handler = policyHandler(detail({}));
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />);
    await screen.findByText(/SCN-FEAT00022-NOMINAL/);
    const run = screen.getByRole('button', { name: '가상검증 실행' });
    expect(run.className).not.toContain('ds-btn--primary');
    expect(visibleText(document.querySelector('#virtual-h')!.closest('section')!)).not.toMatch(CODE);
  });
});

describe('UX3-07 따라하기 허브 — 시작은 보조 버튼, 준비 중은 한 묶음', () => {
  it('강조 버튼 없음 · 준비 중 개수는 요약 한 줄 · 본문에 시나리오 코드 없음', () => {
    mount('/learn', '/learn', <LearnHub />);
    expect(document.querySelector('#root, body')!.querySelector('.ds-btn--primary'), '시작 버튼이 핵심 메시지보다 먼저 보이지 않게').toBeNull();
    const planned = TUTORIALS.filter((t) => t.status !== 'ready').length;
    expect(document.querySelector('.ds-summary')!.textContent).toContain(String(planned));
    expect(document.querySelectorAll('.ds-learn-planned').length).toBe(1);
    // '준비 중'은 요약 한 줄에만 — 카드마다 되풀이하지 않는다
    expect((visibleText().match(/준비 중(?!인)/g) ?? []).length).toBe(1);
    expect(visibleText()).not.toMatch(CODE);
  });
});
