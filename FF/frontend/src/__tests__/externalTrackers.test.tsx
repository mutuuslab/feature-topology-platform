// codeBeamer Trackers 화면·공식 로고 회귀 — 키 없는 진입은 Trackers, 키 있는 기존 링크는 기존 문서 보기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FeatureFlagRow } from '@ff/contracts';
import { AppProvider } from '../store';
import { ExternalWorkspace, type MockExternalItem } from '../external/ExternalApp';
import { ExternalToolLaunchers } from '../external/launchers';
import type { ExternalFeature } from '../external/trace';

const cbItem = (key: string, reqId: string, release: string, extra: Record<string, unknown>, status = 'Approved'): MockExternalItem => ({
  system: 'CODEBEAMER', key, kind: 'REQUIREMENT', title: `${reqId} 요구 ${key}`, body: '설명 문단', status, revision: 1, updatedAt: '2026-11-05T00:00:00.000Z', updatedBy: 'jung.req', comments: [],
  fields: { reqId, tracker: 'FF 시스템 요구사항', release, submittedBy: 'jung.req', ...extra },
});
const items = [
  cbItem('CB-1', 'REQ-PARK-0101', 'FEAT-00001@2.1.0 (시연)', { asil: 'B', assignedTo: 'jung.req' }),
  cbItem('CB-2', 'REQ-ADAS-0501', 'FEAT-00005@5.4.2 (시연)', { asil: 'C', assignedTo: 'seo.safety' }, 'Draft'),
];
const jiraItem: MockExternalItem = { system: 'JIRA', key: 'FFE-13', kind: 'EPIC', title: 'Epic 검토', body: '', status: 'Proposed', revision: 1, updatedAt: '2026-11-05T00:00:00.000Z', updatedBy: 'feature-platform', comments: [], fields: {} };
const features: ExternalFeature[] = [
  { featureId: 'FEAT-00001', version: '2.1.0', name: '원격 주차', ownerId: '주차개발팀', lifecycle: 'VERIFIED', requirementIds: ['REQ-PARK-0101'] },
  { featureId: 'FEAT-00005', version: '5.4.2', name: '스마트 크루즈', ownerId: 'ADAS개발팀', lifecycle: 'RELEASED', requirementIds: ['REQ-ADAS-0501'] },
];
const flags: FeatureFlagRow[] = [
  { flagKey: 'parking_remote_enable', featureId: 'FEAT-00001', version: '2.1.0', featureName: '원격 주차', policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 3, controlPoint: 'Flag' }, sources: [], publication: null },
  { flagKey: 'scc_enable', featureId: 'FEAT-00005', version: '5.4.2', featureName: '스마트 크루즈', policy: null, sources: [], publication: null },
];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/external.html?system=codebeamer&role=viewer');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    let body: unknown = {};
    if (url.startsWith('/api/integrations/mock/codebeamer/items')) body = { items };
    else if (url.startsWith('/api/integrations/mock/jira/items')) body = { items: [jiraItem] };
    else if (url.startsWith('/api/feature-flags')) body = flags;
    else if (url === '/api/features') body = { items: features.map(({ requirementIds: _ids, ...summary }) => summary) };
    else if (url.startsWith('/api/features/')) {
      const [, id, version] = /\/api\/features\/([^/]+)\/versions\/([^/?]+)/.exec(url)!;
      body = { feature: features.find((row) => row.featureId === id && row.version === version) };
    }
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(node: React.ReactNode, platform = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}>{platform ? <AppProvider>{node}</AppProvider> : node}</QueryClientProvider>);
}
const table = () => screen.getByRole('table', { name: 'Trackers 항목 표' });

describe('codeBeamer Trackers 화면', () => {
  it('키 없이 열면 공식 로고·탭 메뉴·트리·그룹 표·상세 패널의 Trackers 화면이 기본이다', async () => {
    mount(<ExternalWorkspace />);
    await screen.findByRole('table', { name: 'Trackers 항목 표' });
    const logo = screen.getByRole('img', { name: 'codeBeamer' });
    expect(logo).toHaveAttribute('src', '/brand/codebeamer-logo.png');
    expect(screen.getByRole('link', { name: 'CodeBeamer · 플랫폼 첫 화면' })).toContainElement(logo);
    const tabs = screen.getByRole('region', { name: 'Trackers' });
    expect(within(tabs).getByRole('button', { name: 'Trackers' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tabs).getByRole('button', { name: 'Documents' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(tabs).getByRole('button', { name: 'Admin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '트래커', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: 'Release · 담당자 트리' })).toBeTruthy();
    expect(within(table()).getByText('REQ-PARK (1 Items)')).toBeTruthy();
    // 그룹 머리는 tbody(행 묶음)의 머리 칸 — 화면 읽기가 열 묶음으로 읽지 않게 rowgroup(2026-11-06 하네스 리뷰)
    const groupHead = within(table()).getByText('REQ-PARK (1 Items)').closest('th')!;
    expect(groupHead).toHaveAttribute('scope', 'rowgroup');
    expect(await screen.findByRole('heading', { name: items[0].title })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toContain('key=CB-1'));
  });

  it('기존 항목 키 링크는 기존 문서 보기로 열리고 Documents·Trackers 탭으로 오간다', async () => {
    window.history.replaceState(null, '', '/external.html?system=codebeamer&key=CB-2&role=viewer');
    mount(<ExternalWorkspace />);
    await screen.findByRole('heading', { name: items[1].title });
    expect(screen.getByRole('button', { name: '문서', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table', { name: 'Trackers 항목 표' })).toBeNull();
    fireEvent.click(within(screen.getByRole('region', { name: 'Trackers' })).getByRole('button', { name: 'Trackers' }));
    expect(table()).toBeTruthy();
    expect(within(table()).getByRole('button', { name: /CB-2/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(screen.getByRole('region', { name: 'Trackers' })).getByRole('button', { name: 'Documents' }));
    expect(screen.getByRole('button', { name: '문서', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  it('트리 선택은 표를 거르고 행 선택은 상세 패널을 바꾼다', async () => {
    mount(<ExternalWorkspace />);
    await screen.findByRole('table', { name: 'Trackers 항목 표' });
    const tree = screen.getByRole('complementary', { name: 'Release · 담당자 트리' });
    expect(within(table()).getByRole('button', { name: /CB-1/ })).toBeTruthy();
    fireEvent.click(within(tree).getByRole('button', { name: /^Release 5\.x/ }));
    expect(within(tree).getByRole('button', { name: /^Release 5\.x/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table()).queryByRole('button', { name: /CB-1/ })).toBeNull();
    expect(within(table()).getByRole('button', { name: /CB-2/ })).toBeTruthy();
    const expand = within(tree).getByRole('button', { name: '하위 버전 펼치기·접기 · Release 5.x' });
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree).getByRole('button', { name: /^FEAT-00005@5\.4\.2/ })).toBeTruthy();
    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(within(tree).queryByRole('button', { name: /^FEAT-00005@5\.4\.2/ })).toBeNull();
    fireEvent.click(within(tree).getByRole('button', { name: /^All Items/ }));
    expect(within(table()).getByRole('button', { name: /CB-1/ })).toBeTruthy();
    fireEvent.click(within(tree).getByRole('button', { name: /^seo\.safety/ }));
    expect(within(table()).queryByRole('button', { name: /CB-1/ })).toBeNull();

    fireEvent.click(within(table()).getByRole('button', { name: /CB-2/ }));
    const detail = screen.getByRole('article', { name: '항목 상세' });
    expect(within(detail).getByRole('heading', { name: items[1].title })).toBeTruthy();
    expect(within(detail).getByTestId('external-current-status')).toHaveTextContent('Draft');
    expect(window.location.search).toContain('key=CB-2');
    const upstream = await within(detail).findByRole('link', { name: 'FEAT-00005@5.4.2 · 스마트 크루즈' });
    expect(upstream).toHaveAttribute('href', '/features/FEAT-00005/5.4.2?tab=ext');
  });

  it('행과 상세 패널에 요구 ID로 확인된 기존 Feature·Flag·정책 연결을 그대로 보인다', async () => {
    mount(<ExternalWorkspace />);
    await screen.findByRole('table', { name: 'Trackers 항목 표' });
    const feature = await within(table()).findByRole('link', { name: 'FEAT-00001@2.1.0' });
    expect(feature).toHaveAttribute('href', '/features/FEAT-00001/2.1.0?tab=ext');
    expect(within(table()).getByRole('link', { name: 'parking_remote_enable' })).toHaveAttribute('href', '/fleet/map?lens=activation&flagKey=parking_remote_enable');
    expect(within(table()).getByRole('link', { name: '정책 POL-00001 · r3' })).toHaveAttribute('href', '/policies/POL-00001');
    expect(within(table()).getByText('주차개발팀')).toBeTruthy();
    const tree = screen.getByRole('complementary', { name: 'Release · 담당자 트리' });
    expect(within(tree).getByRole('button', { name: /^All Items/ })).toHaveTextContent('Flag 2');
    // 기존 추적 패널도 같은 상세 패널 안에 남는다
    expect(await screen.findByRole('region', { name: '플랫폼 추적' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '의견 기록' })).toBeTruthy();
  });
});

describe('외부 도구 공식 로고', () => {
  it('Jira 창 머리글은 공식 로고를 쓰고 기존 보드 보기는 그대로다', async () => {
    window.history.replaceState(null, '', '/external.html?system=jira&role=viewer');
    mount(<ExternalWorkspace />);
    await screen.findByRole('heading', { name: jiraItem.title });
    const logo = screen.getByRole('img', { name: 'Jira' });
    expect(logo).toHaveAttribute('src', '/brand/jira-logo.png');
    expect(screen.getByRole('link', { name: 'JIRA · 플랫폼 첫 화면' })).toContainElement(logo);
    expect(screen.getByRole('button', { name: '보드' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('바로가기 카드는 codeBeamer·Jira 로고로 도구를 표시한다', () => {
    mount(<ExternalToolLaunchers />, true);
    expect(within(screen.getByRole('link', { name: /^codeBeamer .*새 창 열기$/ })).getByRole('img', { name: 'codeBeamer' })).toHaveAttribute('src', '/brand/codebeamer-logo.png');
    expect(within(screen.getByRole('link', { name: /^Jira .*새 창 열기$/ })).getByRole('img', { name: 'Jira' })).toHaveAttribute('src', '/brand/jira-logo.png');
    // 접근 이름 = 보이는 글자(로고·상태·할 일·키) + 낭독용 '새 창 열기' — 따로 붙인 aria-label이 보이는 글자를 빼면 axe label-content-name-mismatch(통합 3차)
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a.external-launcher, a.external-launcher__github')) {
      expect(a.getAttribute('aria-label')).toBeNull();
      const visible = [...a.querySelectorAll('span:not(.ds-sr)')].filter((s) => !s.querySelector('span')).map((s) => s.textContent!.trim()).filter(Boolean);
      // 보이는 글자가 순서대로 이름 안에 있고, 끝은 낭독용 '새 창 열기'
      const inOrder = (n: string) => visible.reduce((at, v) => (at < 0 ? at : n.indexOf(v, at) < 0 ? -1 : n.indexOf(v, at) + v.length), 0) >= 0;
      const name = screen.getByRole('link', { name: (n) => n.endsWith('새 창 열기') && inOrder(n) });
      expect(name).toBe(a);
    }
  });
});
