// ADS 변경 화면 — 승인 경로·릴리스 비교(ADS-UI09), Feature 분류·시장 기준선(ADS-UI12), 일괄 명령 미리보기(ADS-UI03), 확대 판정(ADS-UI11). 모의 API.
// ux.json 확정안의 핵심 메시지·판단 불가·미확인·막힘 사유를 단언한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type AdsChangeImpactView, type ReleaseSnapshot } from '@ff/contracts';
import { classificationCompleteness, classifyChange, diffSummary, expansionVerdict, openPathCounts, pathItems, releaseDiff } from '../../../contracts/src/rules/ads-change';
import { AppProvider } from '../store';
import ImpactScreen from '../screens/governance/Impact';
import { AdsClassificationPanel } from '../screens/ads/AdsClassification';
import { KillBulkPreview } from '../screens/ads/BulkPreviews';
import { ExpansionPanel } from '../screens/ads/ExpansionPanel';
import { DefineScreen } from '../screens/home/Inbox';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any; role: string | null }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, role: new Headers(init?.headers).get('X-Actor-Role') });
      const r = handler(url, init) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, route: string, el: JSX.Element) => {
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

const AGO = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const impact = (o: Partial<AdsChangeImpactView> & Pick<AdsChangeImpactView, 'impactId' | 'featureId' | 'version' | 'facts'>, done: string[] = []): AdsChangeImpactView => {
  const cls = classifyChange(o.facts, o.declaredKind ?? null);
  return {
    baseVersion: null, name: 'x', lifecycle: 'RELEASED', policyId: null, title: o.impactId, declaredKind: null, scopeStatus: 'REVIEW_REQUIRED', assignee: 'ADAS상품기획팀', openedAt: AGO(30),
    reharaOpenAfterRelease: false, reharaRequestIds: [], rejudgeGates: [], ...o, cls,
    paths: pathItems(cls, Object.fromEntries(done.map((p) => [p, { status: 'DONE' as const, closedAt: AGO(20) }]))),
  };
};
const ITEMS = [
  impact({ impactId: 'CI-0001', featureId: 'FEAT-00004', version: '4.1.0', name: '고속도로 주행 보조 2', declaredKind: 'POLICY', facts: { oddWidened: true, oddChanged: true, swChanged: true, modelChanged: false, configChanged: false }, scopeStatus: 'CONFIRMED', rejudgeGates: ['G1', 'G3'] }, ['REHARA', 'R156', 'SUMS', 'SAFETY_CASE']),
  impact({ impactId: 'CI-0002', featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', declaredKind: 'CONFIG', facts: { swChanged: true, modelChanged: true, configChanged: true, oddWidened: false, oddChanged: false }, reharaOpenAfterRelease: true, rejudgeGates: ['G2'] }, ['SAFETY_CASE']),
  impact({ impactId: 'CI-0003', featureId: 'FEAT-00015', version: '1.2.0', name: '지능형 속도 제한 보조', lifecycle: 'DEVELOPING', declaredKind: 'POLICY', facts: {} }),
];
const LIST = { items: ITEMS, counts: openPathCounts(ITEMS), rejudgeGates: 3, assumed: true };

const snap = (o: Partial<ReleaseSnapshot>): ReleaseSnapshot => ({
  featureId: 'FEAT-00004', version: '4.0.1', targets: ['KR · GN7 · Calligraphy'], dependencies: ['FEAT-00084@5.4.2'],
  odd: { speedKmh: { min: 0, max: 130, unit: 'km/h' }, roadType: ['고속도로', '자동차전용도로'], weather: ['맑음', '흐림'] },
  termination: { dc: 'DC2', fallback: '운전자 인계', mrc: '경고 15초 뒤 차로 안에서 감속 정지' }, ...o,
});
const BEFORE = snap({});
const AFTER = snap({ version: '4.1.0', dependencies: ['FEAT-00084@5.5.0'], odd: { ...BEFORE.odd, speedKmh: { min: 0, max: 150, unit: 'km/h' }, roadType: ['고속도로'] }, termination: { ...BEFORE.termination, mrc: '경고 10초 뒤 차로 안에서 감속 정지' } });
const ROWS = releaseDiff(BEFORE, AFTER);
const DIFF = { releaseId: 'FEAT-00004-4.1.0', featureId: 'FEAT-00004', name: '고속도로 주행 보조 2', before: BEFORE, after: AFTER, rows: ROWS, summary: diffSummary(ROWS), cls: classifyChange({ oddWidened: true, oddChanged: true, swChanged: true }), assumed: true };
const RELEASES = { items: [{ releaseId: 'FEAT-00004-4.1.0', featureId: 'FEAT-00004', version: '4.1.0', baseVersion: '4.0.1', name: '고속도로 주행 보조 2', primaryKind: 'ODD' }] };

const api: Handler = (url) => {
  if (url.startsWith('/api/change-impacts')) return { body: LIST };
  if (url.startsWith('/api/releases/FEAT-00004-4.1.0/diff')) return { body: DIFF };
  if (url.startsWith('/api/releases')) return { body: RELEASES };
  return undefined;
};

describe('변경 영향 › 승인 경로 (ADS-UI09)', () => {
  it('핵심 메시지 — 끝나지 않은 승인 경로 3건 — 재-HARA 1 · R156 영향 평가 1 · SUMS 1, Gate 재판정은 보조 줄', async () => {
    handler = api;
    mount('viewer', '/analysis/impact', '/analysis/impact', <ImpactScreen />);
    await waitFor(() => expect(document.querySelector('[data-key-message]')!.textContent).toContain('끝나지 않은 승인 경로 — 재-HARA 1 · R156 영향 평가 1 · SUMS 1'));
    expect(document.querySelector('.ds-key__value')!.textContent).toBe('3건');
    expect(document.querySelectorAll('[data-key-message]')).toHaveLength(1);
    expect(screen.getByText('Gate 재판정')).toBeTruthy();
    // 기존 화면 내용은 '영향 범위' 탭으로 남는다
    expect(screen.getByRole('tab', { name: '영향 범위' })).toBeTruthy();
  });

  it('변경 종류를 판정할 정보가 없으면 정책이 아니라 변경 종류 판단 불가 — 경로 칸도 판단 불가', async () => {
    handler = api;
    mount('viewer', '/analysis/impact?tab=paths', '/analysis/impact', <ImpactScreen />);
    const row = (await screen.findByText('CI-0003')).closest('tr')!;
    expect(row.getAttribute('data-change-kind')).toBe('UNKNOWN');
    expect(within(row).getByText('변경 종류 판단 불가')).toBeTruthy();
    expect(within(row).queryByText('정책')).toBeNull();
    expect(within(row).getByText(/바뀐 ECU·모델 정보가 없어 승인 경로를 정할 수 없습니다/)).toBeTruthy();
    expect(within(row).getAllByText('판단 불가').length).toBeGreaterThanOrEqual(4);
    // 신고값보다 무거운 경로로 승격된 개정
    const odd = screen.getByText('CI-0001').closest('tr')!;
    expect(within(odd).getByText(/신고값 정책 → 바뀐 내용으로 더 무거운 경로/)).toBeTruthy();
  });

  it('출시 뒤 열린 재-HARA가 있으면 배포 서명 대신 막힘 사유 — 권한 없는 역할은 종결 대신 사유 문장', async () => {
    handler = api;
    mount('viewer', '/analysis/impact?tab=paths', '/analysis/impact', <ImpactScreen />);
    const blocked = await screen.findByText('출시 뒤 열린 재-HARA 1건이 있어 배포·서명할 수 없습니다 — 기능안전 담당자의 종결이 필요합니다.');
    const box = blocked.closest('[data-blocked-action]')!;
    expect(within(box as HTMLElement).getByRole('button', { name: '배포 서명' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('승인 경로 종결은 기능안전 담당자(FSM)·사이버보안 담당자(CSM) 역할이 할 수 있습니다.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '경로 종결' })).toBeNull();
  });

  it('기능안전 담당자는 재-HARA 경로를 종결한다 — 그 역할로 보낸다', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { status: 201, body: ITEMS[1] } : api(url, init));
    mount('quality', '/analysis/impact?tab=paths', '/analysis/impact', <ImpactScreen />);
    const row = (await screen.findByText('CI-0002')).closest('tr')!;
    // quality = Gate 판정·Safety Manager — 재-HARA만, R156·SUMS는 사이버보안 담당자
    const buttons = within(row).getAllByRole('button', { name: '경로 종결' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('종결 근거'), { target: { value: '재-HARA 검토 완료' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '종결 기록' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/change-impacts/CI-0002/paths/REHARA/close');
    expect(post.body).toEqual({ reason: '재-HARA 검토 완료' });
    expect(post.role).toBe('SAFETY_OFFICER');
  });

  it('Feature·협력사를 골라 온 주소는 영향 범위 탭으로 연다', async () => {
    handler = api;
    mount('viewer', '/analysis/impact?feature=FEAT-00145&version=5.4.2', '/analysis/impact', <ImpactScreen />);
    await waitFor(() => expect(screen.getByRole('tab', { name: '영향 범위' }).getAttribute('aria-selected')).toBe('true'));
  });
});

describe('변경 영향 › 릴리스 비교 (ADS-UI09)', () => {
  it('ODD 확대와 종료 동작 변경이 있는 두 릴리스 — 두 항목이 강조 행, 확대 행은 운행 조건 확대 글자+경고 글리프', async () => {
    handler = api;
    mount('viewer', '/analysis/impact?tab=release', '/analysis/impact', <ImpactScreen />);
    const widen = await waitFor(() => {
      const el = document.querySelector('tr[data-field="odd.speedKmh"]') as HTMLElement | null;
      if (!el) throw new Error('diff not rendered');
      return el;
    });
    expect(widen.getAttribute('data-direction')).toBe('WIDEN');
    expect(within(widen).getByText('운행 조건 확대')).toBeTruthy();
    expect(widen.querySelector('th[scope="row"]')!.textContent).toBe('운행 조건 · 속도 범위');
    expect(widen.querySelector('svg')).toBeTruthy();
    expect(within(widen).getByText('0–150 km/h')).toBeTruthy();
    const mrc = document.querySelector('tr[data-field="mrc"]')!;
    expect(mrc.getAttribute('data-direction')).toBe('CHANGED');
    expect(screen.getByText('종료 동작 — DC 등급 변경 0 · 대체 동작 변경 0 · MRC 계약 변경 1')).toBeTruthy();
    // 확대 방향이 맨 앞
    expect(document.querySelector('.adc-diff tbody tr')!.getAttribute('data-direction')).toBe('WIDEN');
    // 핵심 메시지
    expect(document.querySelector('[data-key-message]')!.textContent).toContain('운행 조건 확대 — 고속도로 주행 보조 2 4.1.0 · 직전 4.0.1 대비');
    // 기본은 바뀐 필드만 — 같은 필드는 토글로
    expect(document.querySelector('tr[data-field="odd.weather"]')).toBeNull();
    fireEvent.click(screen.getByLabelText('같은 필드도 보기'));
    expect(document.querySelector('tr[data-field="odd.weather"]')!.getAttribute('data-direction')).toBe('SAME');
  });
});

const CLS_VIEW = (o: object = {}) => {
  const c = { featureId: 'FEAT-00010', version: '2.0.0', adsFeature: false, ddtImpact: 'NONE' as const, safetyRelated: true, owner: 'Cabin안전기획팀', source: 'INFERRED' as const, status: 'DRAFT' as const, confirmedBy: null, confirmedAt: null, lifecycleOwners: { CREATE: 'Cabin안전기획팀', OPERATE: '차량운영센터' } };
  return {
    featureId: 'FEAT-00010', version: '2.0.0', lifecycle: 'DEVELOPING', classification: c, completeness: classificationCompleteness(c), safetyProfileStatus: 'DRAFT', ruleEnabled: false,
    baselines: [
      { market: 'EU', featureId: 'FEAT-00010', version: '2.0.0', approvalType: 'TYPE_APPROVAL', regulations: [{ reg: 'UN R79', series: '04' }], oddProfileRef: 'ODD-FEAT-00004-v1', approvalStatus: 'UNKNOWN', assumed: true, note: null },
      { market: 'KR', featureId: 'FEAT-00010', version: '2.0.0', approvalType: 'SELF_CERT', regulations: [{ reg: 'UN R156', series: '00' }], oddProfileRef: 'ODD-FEAT-00004-v1', approvalStatus: 'APPROVED', assumed: true, note: null },
    ],
    ...o,
  };
};

describe('Feature 분류·시장 기준선 (ADS-UI12)', () => {
  it('추정 초안은 추정 — 확정 전 배지이면서 미분류, 출시 전이는 버튼 대신 사유, 상태별 책임자 미지정 글자', async () => {
    handler = (url) => (url.includes('/classification') ? { body: CLS_VIEW() } : undefined);
    mount('viewer', '/features/FEAT-00010/2.0.0', '/features/:id/:ver', <AdsClassificationPanel id="FEAT-00010" ver="2.0.0" lifecycle="DEVELOPING" />);
    expect(await screen.findByText('추정 — 확정 전')).toBeTruthy();
    expect(document.querySelector('[data-ads-classification]')!.getAttribute('data-ads-classification')).toBe('unclassified');
    expect(screen.getAllByText('미분류').length).toBeGreaterThan(0);
    const blocked = screen.getByText('ADS 여부·DDT 영향 분류가 없어 출시 단계로 전이할 수 없습니다 — Feature 작성자가 분류를 입력하세요.');
    expect(within(blocked.closest('[data-blocked-action]') as HTMLElement).getByRole('button', { name: 'RELEASED로 전이' })).toBeTruthy();
    expect(screen.getAllByText('책임자 미지정')).toHaveLength(2);
    // 시장 기준선 — 승인 상태를 모르면 판단 불가
    const eu = document.querySelector('tr[data-market="EU"]') as HTMLElement;
    expect(within(eu).getByText('판단 불가')).toBeTruthy();
    expect(within(eu).getByText('UN R79 04')).toBeTruthy();
    expect(screen.getByText('분류 입력은 Feature 작성자, 확정은 기능안전 담당자(FSM) 역할이 할 수 있습니다.')).toBeTruthy();
  });

  it('행이 없으면 모든 축이 미분류 글자 — ADS 아님으로 보지 않는다', async () => {
    handler = (url) => (url.includes('/classification') ? { body: CLS_VIEW({ classification: null, completeness: classificationCompleteness(null), baselines: [] }) } : undefined);
    mount('author', '/x', '/x', <AdsClassificationPanel id="FEAT-00013" ver="0.3.0" lifecycle="PROPOSED" />);
    await waitFor(() => expect(screen.getAllByText('미분류').length).toBeGreaterThanOrEqual(5));
    expect(screen.queryByText('ADS 아님 — 운전자 보조')).toBeNull();
    // 출시 시장을 정하기 전이라 시장 기준선 영역은 그리지 않는다(빈 상태를 보이지 않음)
    expect(screen.queryByText('시장 기준선')).toBeNull();
  });

  it('분류를 확정했는데 시장 기준선이 없으면 빈 상태 문장', async () => {
    const c = { featureId: 'FEAT-00003', version: '3.3.0', adsFeature: false, ddtImpact: 'NONE' as const, safetyRelated: false, owner: 'UX기획팀', source: 'MANUAL' as const, status: 'CONFIRMED' as const, confirmedBy: 'u', confirmedAt: AGO(5), lifecycleOwners: { CREATE: 'a', OPERATE: 'b', SUSPEND: 'c', DISPOSE: 'd' } };
    handler = (url) => (url.includes('/classification') ? { body: CLS_VIEW({ classification: c, completeness: classificationCompleteness(c), baselines: [] }) } : undefined);
    mount('author', '/x', '/x', <AdsClassificationPanel id="FEAT-00003" ver="3.3.0" lifecycle="VERIFIED" />);
    expect(await screen.findByText('시장 기준선이 없습니다 — 출시 시장을 정하면 시장별 승인 기준을 입력할 수 있습니다.')).toBeTruthy();
    expect(screen.getAllByText('분류 확정').length).toBeGreaterThan(0);
    expect(screen.queryByText('RELEASED로 전이')).toBeNull();
  });

  it('/master/define — 미분류 Feature N건 — 출시 전이 거부 규칙을 켜기 전 점검, ADS 분류 열에 미분류·빈 축', async () => {
    handler = (url) => {
      if (url.startsWith('/api/classification/unclassified'))
        return { body: { items: [{ featureId: 'FEAT-2', version: '0.1.0', name: 'b', lifecycle: 'PROPOSED', ownerId: 'o', gaps: ['ADS', 'DDT', 'SAFETY', 'OWNER', 'LIFECYCLE_OWNER', 'CONFIRM'], inferred: false }, { featureId: 'FEAT-3', version: '1.0.0', name: 'c', lifecycle: 'DEVELOPING', ownerId: 'o', gaps: ['CONFIRM'], inferred: true }], scope: 3, ruleEnabled: false } };
      if (url.startsWith('/api/features'))
        return { body: { items: [{ featureId: 'FEAT-1', version: '2.0.0', name: 'a', lifecycle: 'VERIFIED', ownerId: 'o', gates: {} }, { featureId: 'FEAT-2', version: '0.1.0', name: 'b', lifecycle: 'PROPOSED', ownerId: 'o', gates: {} }, { featureId: 'FEAT-3', version: '1.0.0', name: 'c', lifecycle: 'DEVELOPING', ownerId: 'o', gates: {} }] } };
      return undefined;
    };
    mount('author', '/master/define', '/master/define', <DefineScreen />);
    await waitFor(() => expect(document.querySelector('[data-key-message]')!.textContent).toContain('미분류 Feature — 출시 전이 거부 규칙을 켜기 전 점검'));
    expect(document.querySelector('.ds-key__value')!.textContent).toBe('2건');
    const row2 = (await screen.findByRole('link', { name: 'FEAT-2 0.1.0' })).closest('tr')!;
    expect(await within(row2).findByText('미분류')).toBeTruthy();
    expect(within(row2).getByText('DDT 영향')).toBeTruthy();
    const row3 = screen.getByRole('link', { name: 'FEAT-3 1.0.0' }).closest('tr')!;
    expect(await within(row3).findByText('추정 — 확정 전')).toBeTruthy();
    const row1 = screen.getByRole('link', { name: 'FEAT-1 2.0.0' }).closest('tr')!;
    expect(await within(row1).findByText('분류 확정')).toBeTruthy();
  });
});

const KILL_PV = (o: object = {}) => ({ vehicles: [{ vin: 'ego-01', link: 'ONLINE' }, { vin: 'KMH-NX4-0003', link: 'OFFLINE' }], unknownVins: [], registry: { f_class: 'F3' as const, deact_class: 'DC2' as const }, ...o });

describe('일괄 명령 미리보기 (ADS-UI03)', () => {
  it('서명 대상 digest가 없으면 서버 대상 검증 뒤 표시, 있으면 앞 12자 — 직접 뺀 차량은 제외 사유별 수', async () => {
    handler = () => undefined;
    const { rerender } = mount('operator', '/x', '/x', <KillBulkPreview p={KILL_PV()} vins={['ego-01']} canSign onExcludeUnknown={() => {}} />);
    expect(screen.getByText('서명 대상 digest는 서버 대상 검증 뒤 표시')).toBeTruthy();
    expect(screen.getByText('서명 대상 1대 — 제외 1대')).toBeTruthy();
    expect(screen.getByText(/직접 뺀 차량/)).toBeTruthy();
    expect(document.querySelector('[data-key-message]')).toBeNull(); // Drawer 머리 문장은 핵심 메시지가 아니다
    cleanup();
    mount('operator', '/x', '/x', <KillBulkPreview p={KILL_PV({ targetDigest: 'a1b2c3d4e5f6a7b8c9d0' })} vins={['ego-01', 'KMH-NX4-0003']} canSign onExcludeUnknown={() => {}} />);
    expect(screen.getByText('a1b2c3d4e5f6')).toBeTruthy();
    void rerender;
  });

  it('형상·연결을 모르는 차량은 대상 판단 불가 N대로 따로, 제외하고 진행을 직접 고른다 — 권한 없으면 사유 문장', async () => {
    handler = () => undefined;
    const pick = vi.fn();
    mount('author', '/x', '/x', <KillBulkPreview p={KILL_PV({ unknownVins: ['X-1', 'X-2'] })} vins={['ego-01']} canSign={false} onExcludeUnknown={pick} />);
    expect(screen.getByText('대상 판단 불가 2대')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('판단 불가 차량을 제외하고 진행'));
    expect(pick).toHaveBeenCalledWith(true);
    expect(screen.getByText('서명·발행은 운영자·기능안전 담당자(FSM) 역할이 할 수 있습니다 — 미리보기는 볼 수 있습니다.')).toBeTruthy();
  });
});

describe('확대 판정 (ADS-UI11)', () => {
  it('감시 지표가 기준 시간을 넘기면 확대 보류 — 지표 지연, 미확인 차량은 노출량에서 빼고 따로', async () => {
    const now = Date.now();
    const metrics = [
      { key: 'takeoverRate', observedAt: new Date(now - 125 * 60_000).toISOString(), staleAfterMs: 30 * 60_000, value: 0.8, threshold: 2, breached: false },
      { key: 'falseBrakeRate', observedAt: new Date(now - 12 * 60_000).toISOString(), staleAfterMs: 30 * 60_000, value: 0.05, threshold: 0.2, breached: false },
    ];
    const combos = [
      { comboId: 'NX4 PE · Premium · KR', vehicleActive: 1120, usageConfirmed: 860, errors: 3, samples: 1120, minSamples: 300, windowHours: 72, alert: false },
      { comboId: 'NX4 PE · Modern · KR', vehicleActive: 700, usageConfirmed: 510, errors: 1, samples: 180, minSamples: 300, windowHours: 72, alert: false },
    ];
    const result = expansionVerdict({ frozen: null, metrics, combos, now });
    handler = (url) => (url.includes('/expansion') ? { body: { policyId: 'POL-00002', featureId: 'FEAT-00022', featureVersion: '1.0.0', result, vehicleActive: 1820, unconfirmed: 140, policyAllowed: 2400, metrics, combos, frozen: null, assumed: true } } : undefined);
    mount('viewer', '/x', '/x', <ExpansionPanel policyId="POL-00002" />);
    expect(await screen.findByText('확대 보류')).toBeTruthy();
    expect(screen.getByText('감시 지표가 2시간 지연')).toBeTruthy();
    expect(screen.getByText('1,820대')).toBeTruthy();
    expect(screen.getByText('140대')).toBeTruthy();
    expect(screen.getByText('감시 지표가 기준 시간(30분)보다 오래됐습니다 — 새 지표가 들어올 때까지 확대할 수 없습니다.')).toBeTruthy();
    expect(screen.queryByText('확대 가능')).toBeNull();
    // 판정을 막은 조합(표본 부족)이 있으면 근거 영역을 펼친다
    expect((document.querySelector('.adc-combos') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText('표본 부족')).toBeTruthy();
    expect(screen.getByText('동결·해제·확대는 Feature 출시 담당자·운영 리더 역할이 할 수 있습니다.')).toBeTruthy();
  });

  it('이 정책에 판정 입력이 없으면(404) 그리지 않는다', async () => {
    handler = (url) => (url.includes('/expansion') ? { status: 404, body: { message: 'x' } } : undefined);
    mount('viewer', '/x', '/x', <ExpansionPanel policyId="POL-00009" />);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/expansion'))).toBe(true));
    expect(document.querySelector('[data-expansion]')).toBeNull();
  });
});
