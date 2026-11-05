import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../store';
import { ExternalWorkspace, type MockExternalItem } from '../external/ExternalApp';
import { ExternalToolLaunchers } from '../external/launchers';
import { externalReferenceUrl, EXTERNAL_CHANGE_KEY, GITHUB_PR_URL } from '../external/links';
import { ExtLinksTab } from '../screens/features/ExtLinksTab';
import type { FeatureFlagRow } from '@ff/contracts';
import { externalTrace, flagMapHref, type ExternalFeature } from '../external/trace';

let item: MockExternalItem;
let posts: { body: any; headers: Record<string, string> }[];
let rejectTransition: boolean;
let failWrite: boolean;
let traceReads: number;
let featureRows: ExternalFeature[];
let flagRows: FeatureFlagRow[];
let failFlagRead: boolean;
let failedFeature: string;
let detailReads: string[];
let publicationBody: unknown;
let connectionsBody: unknown;
const source = { repository: 'https://github.com/mutuuslab/feature-topology-platform', provider: 'GITHUB' as const, commit: 'a'.repeat(40), url: `https://github.com/mutuuslab/feature-topology-platform/blob/${'a'.repeat(40)}/FF/example.ts#L8`, path: 'FF/example.ts', line: 8, symbol: 'client.getBooleanValue', method: 'getBooleanValue' as const, safeDefault: 'EXPLICIT_FALSE' as const, contentHash: 'sha256:' + 'b'.repeat(64), importedAt: '2026-11-05T00:00:00.000Z', importedBy: 'usr-integrator', provenance: 'CI_IMPORT' as const };
const feature: ExternalFeature = { featureId: 'FEAT-00001', version: '2.1.0', name: '실제 원격 주차', ownerId: '주차개발팀', lifecycle: 'VERIFIED', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', requirementIds: ['REQ-PARK-0101'] };
const flag: FeatureFlagRow = { flagKey: 'parking_remote_enable', featureId: feature.featureId, version: feature.version, featureName: feature.name!, policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 3, controlPoint: 'Flag' }, sources: [source], publication: { publicationId: 'PUB-00001', status: 'PARTIAL', confirmed: 2, denominator: 5 } };
const makeItem = (system = 'CODEBEAMER'): MockExternalItem => ({ system, key: system === 'JIRA' ? 'FFE-13' : 'CB-10001', kind: system === 'JIRA' ? 'EPIC' : 'REQUIREMENT', title: '차간 거리 요구 검토', body: '제동 거리와 안전 기본값을 확인한다.', status: system === 'JIRA' ? 'Proposed' : 'Approved', revision: 1, updatedAt: '2026-11-05T00:00:00.000Z', updatedBy: 'feature-platform', comments: [], fields: {} });

beforeEach(() => {
  localStorage.clear(); item = makeItem(); posts = []; rejectTransition = false; failWrite = false; traceReads = 0; featureRows = []; flagRows = [flag]; failFlagRead = false; failedFeature = ''; detailReads = []; connectionsBody = null;
  publicationBody = { publication: { publicationId: 'PUB-00001', kind: 'POLICY', createdAt: '2026-11-05T00:00:00.000Z', status: 'PARTIAL', confirmed: 2, denominator: 5, payload: { publicationId: 'PUB-00001', featureId: flag.featureId, featureVersion: flag.version, flagKey: flag.flagKey, policy: { policyId: flag.policy!.policyId, revision: flag.policy!.revision }, targets: ['VIN-DEMO-1'] } }, verification: { valid: true }, readbacks: [{ publicationId: 'PUB-00001', vin: 'VIN-DEMO-1', at: '2026-11-05T00:02:00.000Z', observed: 'ON' }] };
  window.history.replaceState(null, '', '/external.html?system=codebeamer&key=CB-10001&role=quality');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown;
    if (init?.method === 'POST') {
      const sent = JSON.parse(String(init.body)); posts.push({ body: sent, headers: init.headers as Record<string, string> });
      if (failWrite) return new Response(JSON.stringify({ error: { code: 'GUARD_FAILED', message: '모의 연결이 아닙니다.' } }), { status: 422 });
      item = { ...item, revision: item.revision + 1 };
      if (sent.action === 'COMMENT') item.comments = [...item.comments, { at: item.updatedAt, by: sent.externalUser, text: sent.comment }];
      else if (!rejectTransition) item.status = sent.status;
      body = { item, result: { outcome: rejectTransition ? 'REJECTED' : 'IGNORED', summary: rejectTransition ? '권한이 없어 Proposed 상태로 되돌립니다.' : '바뀐 내용 없음' } };
    } else if (url.startsWith('/api/feature-flags')) {
      if (failFlagRead) return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Flag 원장 조회 실패' } }), { status: 503 });
      body = flagRows;
    } else if (url.startsWith('/api/publications/')) body = publicationBody;
    else if (url.startsWith('/api/system/connections') && connectionsBody) body = connectionsBody;
    else if (url === '/api/features') body = { items: featureRows.map(({ requirementIds: _requirements, ...summary }) => summary) };
    else if (url.startsWith('/api/features/')) {
      const [, id, version] = /\/api\/features\/([^/]+)\/versions\/([^/?]+)/.exec(url)!;
      const key = `${id}@${version}`; detailReads.push(key);
      if (key === failedFeature) return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: '상세 조회 실패' } }), { status: 503 });
      body = { feature: featureRows.find((row) => row.featureId === id && row.version === version) };
    }
    else if (url.startsWith('/api/integrations/sync/features')) {
      traceReads++;
      body = { featureId: 'FEAT-00001', version: '2.1.0', lifecycle: 'VERIFIED', epicStatusExpected: 'In Verification', requirements: [], missingRequirements: [], epic: null, changeRequests: [], defects: [], mergeRequests: [], pipelines: [], policies: [], conflicts: [], stale: [] };
    } else body = { items: [item] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
});

describe('외부 항목의 정확한 원장 결합', () => {
  it('요구 ID를 정확히 비교해 모든 Feature Version을 보존하고 제목·유사 ID는 추측하지 않는다', () => {
    const cb = { system: 'CODEBEAMER', key: 'CB-1', fields: { reqId: 'REQ-PARK-0101' } };
    const next = { ...feature, version: '2.2.0' };
    const unrelated = { ...feature, featureId: 'FEAT-00009', requirementIds: ['REQ-PARK-01010'] };
    const found = externalTrace(cb, [feature, next, unrelated], [flag, { ...flag, featureId: unrelated.featureId, flagKey: 'unrelated' }]);
    expect(found.features.map((row) => row.version)).toEqual(['2.1.0', '2.2.0']);
    expect(found.features.every((row) => row.origins.includes('REQUIREMENT_ID'))).toBe(true);
    expect(found.flags.map((row) => row.flagKey)).toEqual(['parking_remote_enable']);
    expect(externalTrace({ ...cb, fields: {} }, [feature], [flag]).features).toEqual([]);
  });

  it('JIRA CR은 정확한 정책만 연결하고 동일 Feature의 다른 Flag와 미연결 소스를 붙이지 않는다', () => {
    const context = externalTrace({ system: 'JIRA', key: 'FFCR-1', fields: { policyId: 'POL-00001' } }, [feature], [flag, { ...flag, flagKey: 'other_policy', policy: { ...flag.policy!, policyId: 'POL-00002' } }, { ...flag, flagKey: 'orphan', featureId: null, version: null, policy: null }]);
    expect(context.features[0]).toMatchObject({ featureId: 'FEAT-00001', version: '2.1.0', origins: ['POLICY'] });
    expect(context.flags.map((row) => row.flagKey)).toEqual(['parking_remote_enable']);
    expect(flagMapHref(context.flags[0].flagKey)).toBe('/fleet/map?lens=activation&flagKey=parking_remote_enable');
  });

  it('외부 Feature와 정책 참조가 다르면 충돌로 드러내고 잘못된 경로·없는 버전은 채우지 않는다', () => {
    const mismatch = externalTrace({ system: 'JIRA', key: 'FFCR-1', fields: { featureId: 'FEAT-00009', version: '1.0.0', policyId: 'POL-00001' } }, [feature], [flag]);
    expect(mismatch.referenceConflict).toBe(true);
    expect(mismatch.flags).toEqual([flag]);
    expect(externalTrace({ system: 'JIRA', key: 'FFE-1', fields: { featureId: 'FEAT-00001' } }, [feature], [flag]).features).toEqual([]);
    expect(externalTrace({ system: 'JIRA', key: 'FFE-1', fields: { featureId: '../admin', version: '2.1.0' } }, [feature], [flag]).features).toEqual([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(node: React.ReactNode, platform = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}>{platform ? <AppProvider>{node}</AppProvider> : node}</QueryClientProvider>);
}

describe('외부 도구 창 연결', () => {
  it('예약된 데모 호스트만 독립 창으로 바꾸고 고객 URL·GitLab·운영 빌드는 유지한다', () => {
    const demo = { system: 'JIRA', key: 'FFE-3', url: 'https://jira.ff.example/browse/FFE-3' };
    expect(externalReferenceUrl(demo, true)).toBe('/external.html?system=jira&key=FFE-3');
    expect(externalReferenceUrl(demo, false)).toBe(demo.url);
    for (const url of ['https://jira.customer.example/browse/FFE-3', 'https://jira.ff.example.evil.test/browse/FFE-3', 'https://jira.ff.example@customer.test/browse/FFE-3']) expect(externalReferenceUrl({ ...demo, url }, true)).toBe(url);
    const gitlab = { ...demo, system: 'GITLAB', url: 'https://gitlab.ff.example/project/-/merge_requests/8' };
    expect(externalReferenceUrl(gitlab, true)).toBe(gitlab.url);
  });

  it('세 도구를 강조하고 현재 역할을 별도 팝업에 전달하며 실제 PR·소스·커밋을 연결한다', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'approver' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount(<ExternalToolLaunchers />, true);
    const cb = screen.getByRole('link', { name: 'CodeBeamer 새 창 열기' });
    expect(cb.getAttribute('href')).toBe('/external.html?system=codebeamer&role=approver');
    fireEvent.click(cb);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expect.stringContaining('/external.html?system=codebeamer&role=approver'), '_blank', expect.stringContaining('popup=yes,noopener,noreferrer'));
    expect(screen.getByRole('link', { name: 'GitHub PR #9 새 창 열기' }).getAttribute('href')).toBe(GITHUB_PR_URL);
    expect((await screen.findByRole('link', { name: 'Flag 소스' })).getAttribute('href')).toBe(source.url);
    expect(screen.getByRole('link', { name: /스캔한 커밋/ }).getAttribute('href')).toBe(`${source.repository}/commit/${source.commit}`);
    expect(screen.getAllByText('가상 연계 시연')).toHaveLength(2);
  });

  it('외부 창의 변경 알림을 받으면 이미 열린 Feature 추적을 다시 읽는다', async () => {
    mount(<ExtLinksTab id="FEAT-00001" ver="2.1.0" />, true);
    await screen.findByTestId('ext-links');
    const before = traceReads;
    fireEvent(window, new StorageEvent('storage', { key: EXTERNAL_CHANGE_KEY, newValue: 'changed' }));
    await waitFor(() => expect(traceReads).toBeGreaterThan(before));
  });
});

describe('공유 모의 원장을 사용하는 독립 앱', () => {
  it('CB 요구 ID를 실제 Feature 상세와 결합해 Flag·정책·소스·커밋·회신·지도까지 이어 준다', async () => {
    item.fields = { reqId: 'REQ-PARK-0101', tracker: 'FF 시스템 요구사항', release: '시연 2026.11' };
    featureRows = [feature, { ...feature, version: '2.2.0' }];
    mount(<ExternalWorkspace />);
    const trace = await screen.findByRole('region', { name: '플랫폼 추적' });
    await waitFor(() => expect(within(trace).getByRole('link', { name: 'FEAT-00001@2.1.0' })).toBeTruthy());
    expect(within(trace).getByRole('link', { name: 'FEAT-00001@2.2.0' }).getAttribute('href')).toBe('/features/FEAT-00001/2.2.0?tab=ext');
    expect(detailReads.sort()).toEqual(['FEAT-00001@2.1.0', 'FEAT-00001@2.2.0']);
    expect(within(trace).getByText('parking_remote_enable')).toBeTruthy();
    expect(within(trace).getByRole('link', { name: 'POL-00001 · r3' }).getAttribute('href')).toBe('/policies/POL-00001');
    expect(within(trace).getByRole('link', { name: 'FF/example.ts:8' }).getAttribute('href')).toBe(source.url);
    expect(within(trace).getByRole('link', { name: /확정 커밋/ }).getAttribute('href')).toBe(source.repository + '/commit/' + source.commit);
    expect(within(trace).getByRole('link', { name: 'Flag 적용 차량 지도' }).getAttribute('href')).toBe('/fleet/map?lens=activation&flagKey=parking_remote_enable');
    expect(await within(trace).findByText('일부 회신 · 일치 회신 2/5')).toBeTruthy();
    const stages = within(trace).getByRole('list', { name: '평가·배포·수신 근거' });
    expect(within(stages).getAllByRole('listitem')).toHaveLength(3);
    expect(within(stages).getByRole('link', { name: '서명·배포 근거 확인 · PUB-00001' })).toHaveAttribute('href', '/deployments/PUB-00001');
    expect(within(stages).getByRole('link', { name: 'VIN-DEMO-1' })).toHaveAttribute('href', '/fleet/vehicles/VIN-DEMO-1');
    expect(within(trace).getAllByText('Feature 담당 조직 · 주차개발팀')).toHaveLength(2);
  });

  it('최종 변경자를 담당자로 지어내지 않으며 홈 로고는 같은 창의 플랫폼 첫 화면으로 연결한다', async () => {
    mount(<ExternalWorkspace />); await screen.findByRole('heading', { name: item.title });
    const properties = screen.getByRole('region', { name: '세부 사항' });
    expect(within(properties).getByText('Assigned to').nextElementSibling).toHaveTextContent('확인 필요');
    expect(within(properties).getByText('Modified by').nextElementSibling).toHaveTextContent('feature-platform');
    const logo = screen.getByRole('link', { name: 'CodeBeamer · 플랫폼 첫 화면' });
    expect(logo.getAttribute('href')).toBe('/'); expect(logo.getAttribute('target')).toBeNull();
    expect(screen.getByRole('link', { name: '플랫폼 연계로 돌아가기' }).getAttribute('target')).toBeNull();
  });

  it('데모 seamless(80-50 D-ALM-17) — 시연 배지·안내 줄·시연 계정 문구 없이 연다, labeled면 그대로 보인다', async () => {
    connectionsBody = { mode: 'demo', presentation: 'seamless', items: [] };
    const { unmount } = mount(<ExternalWorkspace />);
    await screen.findByRole('heading', { name: item.title });
    await waitFor(() => expect(document.querySelector('.external-demo-badge')).toBeNull());
    expect(document.querySelector('.external-notice')).toBeNull();
    expect(document.body.textContent).not.toMatch(/가상 연계 시연|시연용 외부 도구|플랫폼 시연 계정/);
    unmount();
    connectionsBody = { mode: 'demo', presentation: 'labeled', items: [] };
    mount(<ExternalWorkspace />);
    await screen.findByRole('heading', { name: item.title });
    expect(screen.getByText('가상 연계 시연', { exact: true })).toBeTruthy();
  });

  it('부분 상세 조회 실패는 연결 없음으로 단정하지 않고 다시 확인할 대상을 알린다', async () => {
    item.fields = { reqId: 'REQ-PARK-0101' }; featureRows = [feature]; failedFeature = 'FEAT-00001@2.1.0';
    mount(<ExternalWorkspace />);
    expect(await screen.findByText(/Feature 상세 1건을 확인하지 못했습니다/)).toBeTruthy();
    expect(screen.queryByText('확인된 Feature Version 연결이 없습니다. 외부 참조와 요구 ID를 확인하세요.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Flag 적용 차량 지도' })).toBeNull();
  });

  it('Flag API 오류를 미연결 성공으로 숨기지 않고 의견 입력은 계속 보존한다', async () => {
    item = makeItem('JIRA'); item.fields = { policyId: 'POL-00001' }; failFlagRead = true;
    window.history.replaceState(null, '', '/external.html?system=jira&key=FFE-13&role=author');
    mount(<ExternalWorkspace />);
    expect(await screen.findByText('연결 조회를 완료하지 못했습니다. 다시 불러오세요.')).toBeTruthy();
    expect(screen.queryByText('이 항목에 연결된 Flag는 확인되지 않았습니다.')).toBeNull();
    fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '외부 원장 검토 진행' } });
    expect(screen.getByLabelText('검토 의견')).toHaveValue('외부 원장 검토 진행');
  });

  it('깨진 소스 응답은 링크나 차량 지도를 만들지 않고 조회 오류로 알린다', async () => {
    item = makeItem('JIRA'); item.fields = { policyId: 'POL-00001' };
    flagRows = [{ ...flag, sources: [{} as never] }];
    window.history.replaceState(null, '', '/external.html?system=jira&key=FFE-13&role=author');
    mount(<ExternalWorkspace />);
    expect(await screen.findByText('Flag 연결 응답을 확인할 수 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Flag 적용 차량 지도' })).toBeNull();
    expect(screen.getByLabelText('검토 의견')).toBeEnabled();
  });

  it('JIRA 세부 사항은 실제 담당자·보고자·기한·우선순위 필드를 구분해 표시한다', async () => {
    item = makeItem('JIRA'); item.fields = { featureId: feature.featureId, version: feature.version, assignee: { displayName: '시연 개발 담당' }, reporter: '시연 검토 담당', dueDate: '2026-11-10', priority: 'High' };
    featureRows = [feature]; window.history.replaceState(null, '', '/external.html?system=jira&key=FFE-13&role=author');
    mount(<ExternalWorkspace />); await screen.findByRole('heading', { name: item.title });
    const properties = screen.getByRole('region', { name: '세부 사항' });
    expect(within(properties).getByText('담당자').nextElementSibling).toHaveTextContent('시연 개발 담당');
    expect(within(properties).getByText('보고자').nextElementSibling).toHaveTextContent('시연 검토 담당');
    expect(within(properties).getByText('기한').nextElementSibling).toHaveTextContent('2026-11-10');
    expect(within(properties).getByText('우선 순위').nextElementSibling).toHaveTextContent('High');
    expect(within(properties).queryByText('Risk')).toBeNull();
    expect(await screen.findByRole('link', { name: 'FEAT-00001@2.1.0' })).toBeTruthy();
  });

  it('문서·표·항목 상세 전환과 전체 URL 복사는 선택된 실제 항목을 유지한다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.create(window.navigator, { clipboard: { value: { writeText } } }));
    mount(<ExternalWorkspace />); await screen.findByRole('heading', { name: item.title });
    fireEvent.click(screen.getByRole('button', { name: '표', exact: true }));
    expect(screen.getByRole('table', { name: 'CodeBeamer 요구사항 목록' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('table', { name: 'CodeBeamer 요구사항 목록' })).getByRole('button', { name: /CB-10001/ }));
    expect(screen.getByRole('button', { name: '항목 상세', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('external-current-status')).toHaveTextContent('Approved');
    fireEvent.click(screen.getByRole('button', { name: 'URL 복사' }));
    await screen.findByText('현재 항목 URL을 복사했습니다.');
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByLabelText('현재 항목 전체 URL')).toHaveValue(window.location.href);
  });

  it('키 없이 도구를 열어도 선택된 실제 항목 키를 URL에 확정해 공유할 수 있다', async () => {
    window.history.replaceState(null, '', '/external.html?system=codebeamer&role=viewer');
    mount(<ExternalWorkspace />); await screen.findByRole('heading', { name: item.title });
    await waitFor(() => expect(window.location.search).toContain('key=CB-10001'));
    expect(screen.getByLabelText('현재 항목 전체 URL')).toHaveValue(window.location.href);
  });

  it('CodeBeamer 의견을 실제 API에 등록하고 다시 읽은 기록을 표시한다', async () => {
    mount(<ExternalWorkspace />);
    expect(await screen.findByRole('heading', { name: item.title })).toBeTruthy();
    expect(screen.getByText('가상 연계 시연')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    const submit = screen.getByRole('button', { name: '의견 등록' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '  안전 기본값 검토 완료  ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(within(screen.getByRole('region', { name: '의견 기록' })).getByText('안전 기본값 검토 완료')).toBeTruthy());
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ key: 'CB-10001', externalUser: 'seo.safety', deliver: true, action: 'COMMENT', comment: '안전 기본값 검토 완료' });
    expect(posts[0].headers['X-Actor-Role']).toBe('SAFETY_OFFICER');
    expect(screen.getByTestId('external-current-status')).toHaveTextContent('Approved');
    expect(localStorage.getItem(EXTERNAL_CHANGE_KEY)).toContain('CB-10001');
  });

  it('JIRA 전이가 거부되면 희망 상태 대신 서버의 되돌린 상태와 사유를 보인다', async () => {
    item = makeItem('JIRA'); rejectTransition = true;
    window.history.replaceState(null, '', '/external.html?system=jira&key=FFE-13&role=author');
    mount(<ExternalWorkspace />);
    await screen.findByRole('heading', { name: item.title });
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'Approved' } });
    fireEvent.click(screen.getByRole('button', { name: '상태 변경 요청' }));
    expect(await screen.findByText('거부·되돌림')).toBeTruthy();
    expect(screen.getByText('권한이 없어 Proposed 상태로 되돌립니다.')).toBeTruthy();
    expect(screen.getByTestId('external-current-status')).toHaveTextContent('Proposed');
    expect(posts[0].body.externalUser).toBe('kim.author');
    expect(posts[0].headers['X-Actor-Role']).toBe('FEATURE_AUTHOR');
  });

  it('서버가 쓰기를 거절하면 의견을 보존하고 저장됐다고 표시하지 않는다', async () => {
    failWrite = true; mount(<ExternalWorkspace />);
    await screen.findByRole('heading', { name: item.title });
    fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '다시 확인할 의견' } });
    fireEvent.click(screen.getByRole('button', { name: '의견 등록' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('검토 의견')).toHaveValue('다시 확인할 의견');
    expect(screen.getByText('아직 의견이 없습니다.')).toBeTruthy();
    expect(localStorage.getItem(EXTERNAL_CHANGE_KEY)).toBeNull();
  });

  it('없는 키를 열면 다른 항목을 대신 선택해 변경하지 않는다', async () => {
    window.history.replaceState(null, '', '/external.html?system=codebeamer&key=CB-DOES-NOT-EXIST');
    mount(<ExternalWorkspace />);
    expect(await screen.findByText('요청한 항목이 없습니다. 목록에서 다른 항목을 선택하세요.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '상태 변경 요청' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /CB-10001/ }));
    expect(await screen.findByRole('heading', { name: item.title })).toBeTruthy();
    expect(window.location.search).toContain('key=CB-10001');
  });

  it('JIRA 보드·목록 전환과 키 검색은 같은 공유 항목을 보여 준다', async () => {
    item = makeItem('JIRA'); window.history.replaceState(null, '', '/external.html?system=jira');
    mount(<ExternalWorkspace />); await screen.findByRole('heading', { name: item.title });
    expect(screen.getByRole('button', { name: '보드' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '목록' }));
    expect(screen.getByRole('button', { name: '목록' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('키·제목 검색'), { target: { value: '찾을 수 없음' } });
    expect(screen.getByText('조건에 맞는 항목이 없습니다.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('키·제목 검색'), { target: { value: 'FFE-13' } });
    expect(screen.getByRole('button', { name: /FFE-13/ })).toBeTruthy();
  });

  it('알 수 없는 역할이나 계정 없는 직접 진입은 열람이며 쓰기 역할을 임의로 얻지 않는다', async () => {
    window.history.replaceState(null, '', '/external.html?system=codebeamer&role=not-a-role');
    mount(<ExternalWorkspace />); await screen.findByRole('heading', { name: item.title });
    expect(screen.getByLabelText('검토 의견')).toBeDisabled();
    expect(screen.getByRole('button', { name: '의견 등록' })).toBeDisabled();
    expect(screen.getByText(/열람 계정은 항목을 확인/)).toBeTruthy();
    expect(posts).toHaveLength(0);
  });
});
