// GitLab MR 시연 창 — Feature 상세 연계 탭의 MR 링크(gitlab.ff.example)가 깨진 외부 주소 대신 외부 시연 창으로 열리고,
// MR 상세(제목·작성자·브랜치·상태·변경 파일·파이프라인·연결된 Feature/Flag)가 빈 칸 없이 보인다. 연결은 연계 원장으로 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ExternalApp, type MockExternalItem } from '../external/ExternalApp';
import { featureCandidate, mrChanges } from '../external/GitLabApp';
import { externalReferenceUrl } from '../external/links';
import { ExtRefChip } from '../design/ext-ref';

const SHA = '8748843407be53759e6fbfb25c3a5c5de4e0a217';
const mr = (n: number, feature: string, extra: Record<string, unknown> = {}): MockExternalItem => ({
  system: 'GITLAB', key: `vehicle/feature-sw!${n}`, kind: 'MERGE_REQUEST', title: `${feature} 전방 안전거리 3단계`, body: `구현 ${feature} SW-CARE-SDIST-APP@1.2.1`, status: 'merged', revision: 1,
  updatedAt: '2026-11-05T10:03:22.166Z', updatedBy: 'han.dev', comments: [], fields: { sha: SHA, sourceBranch: `feature/${feature.toLowerCase().replace('@', '-')}`, targetBranch: 'main', description: `구현 ${feature}`, ...extra },
});
const pipeline = (n: number, mrKey: string): MockExternalItem => ({ system: 'GITLAB', key: `pipeline/${n}`, kind: 'PIPELINE', title: 'pipeline', body: '', status: 'success', revision: 1, updatedAt: '2026-11-05T10:03:22.166Z', updatedBy: 'han.dev', comments: [], fields: { sha: SHA, ref: 'feature/feat-00022-1.0.0', mrKey } });
const ITEMS = [mr(117, 'FEAT-00022@1.0.0'), pipeline(50017, 'vehicle/feature-sw!117'), mr(146, 'FEAT-00144@3.3.0', { commitStatuses: [{ name: 'ff/gate-G8', state: 'success', description: 'Feature Platform G8 PASS' }] }), pipeline(50046, 'vehicle/feature-sw!146')];
const SOURCE = { repository: 'https://github.com/mutuuslab/feature-topology-platform', provider: 'GITHUB', commit: 'a'.repeat(40), url: 'https://github.com/mutuuslab/feature-topology-platform/blob/x/FF/examples/feature-flag-consumer/distance.ts#L10', path: 'FF/examples/feature-flag-consumer/distance.ts', line: 10, symbol: 'client.getBooleanValue', contentHash: 'sha256:x', importedAt: '2026-11-05T00:00:00.000Z', importedBy: 'usr-integrator', provenance: 'DEMO' };
const FLAGS = [{ flagKey: 'care_00022_param', featureId: 'FEAT-00022', version: '1.0.0', featureName: '전방 안전거리 3단계', policy: null, publication: null, sources: [SOURCE] }];
let traceMrs: string[];

beforeEach(() => {
  traceMrs = ['vehicle/feature-sw!117'];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    let body: unknown;
    if (url.startsWith('/api/integrations/mock/gitlab/items')) body = { items: ITEMS };
    else if (url.startsWith('/api/integrations/sync/features/')) {
      const [, id, ver] = /features\/([^/]+)\/([^/?]+)/.exec(url)!;
      body = { featureId: id, version: ver, mergeRequests: traceMrs.map((key) => ({ key })), policies: id === 'FEAT-00022' ? [{ policyId: 'POL-00002', flagKey: 'care_00022_param', status: 'DEPLOYED', changeRequests: [] }] : [] };
    } else if (url.startsWith('/api/features/')) {
      const [, id, ver] = /features\/([^/]+)\/versions\/([^/?]+)/.exec(url)!;
      body = { feature: { featureId: id, version: ver, name: id === 'FEAT-00022' ? '전방 안전거리 3단계' : '서라운드 뷰 모니터', lifecycle: 'RELEASED', ownerId: 'ADAS상품기획팀', swIds: ['SW-CARE-SDIST-APP', 'SW-CARE-SCC-ADP'], swVersions: ['1.2.1', '2.3.0'], ecuPnos: ['99211-NX400', '99211-NX400'], controlPoints: ['Flag', 'Signal'] } };
    } else if (url.startsWith('/api/feature-flags')) body = url.includes('FEAT-00022') ? FLAGS : [];
    else body = { items: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('GitLab MR 시연 창', () => {
  it('Feature 상세 연계 탭의 MR 링크는 깨진 외부 주소 대신 GitLab 시연 창으로 연결 Feature를 함께 넘긴다', () => {
    render(<ExtRefChip r={{ system: 'GITLAB', kind: 'MERGE_REQUEST', key: 'vehicle/feature-sw!117', url: 'https://gitlab.ff.example/vehicle/feature-sw/-/merge_requests/117', status: 'merged', syncState: 'SYNCED', stale: false, title: '', entityId: 'FEAT-00022@1.0.0' }} />);
    const href = screen.getByRole('link', { name: 'vehicle/feature-sw!117' }).getAttribute('href')!;
    expect(href.startsWith('/external.html?')).toBe(true);
    const q = new URL(href, 'http://x').searchParams;
    expect([q.get('system'), q.get('key'), q.get('feature')]).toEqual(['gitlab', 'vehicle/feature-sw!117', 'FEAT-00022@1.0.0']);
    // 파이프라인 링크도 같은 창(파이프라인의 MR을 연다)
    expect(externalReferenceUrl({ system: 'GITLAB', key: 'pipeline/50017', url: 'https://gitlab.ff.example/vehicle/feature-sw/-/pipelines/50017' }, true)).toBe('/external.html?system=gitlab&key=pipeline%2F50017');
  });

  it('MR 상세 — 제목·작성자·브랜치·상태·파이프라인·변경 파일·연결된 Feature/Flag를 빈 칸 없이 보인다', async () => {
    window.history.replaceState(null, '', '/external.html?system=gitlab&key=vehicle%2Ffeature-sw%21117&feature=FEAT-00022%401.0.0');
    render(<ExternalApp />);
    const detail = await screen.findByTestId('gl-detail');
    expect(within(detail).getByRole('heading', { level: 2 }).textContent).toContain('FEAT-00022@1.0.0 전방 안전거리 3단계');
    expect(within(detail).getByText('!117')).toBeTruthy();
    expect(detail.textContent).toContain('han.dev 님이 feature/feat-00022-1.0.0 → main 병합을 요청했습니다');
    expect(within(screen.getByTestId('gl-pipeline')).getByText('#50017')).toBeTruthy();
    expect(within(screen.getByTestId('gl-pipeline')).getByText('통과')).toBeTruthy();
    const linked = screen.getByTestId('gl-linked');
    expect((await within(linked).findByRole('link', { name: /FEAT-00022@1\.0\.0/ })).getAttribute('href')).toBe('/features/FEAT-00022/1.0.0?tab=ext');
    expect(within(linked).getByText('care_00022_param')).toBeTruthy();
    expect(within(linked).getByRole('link', { name: '정책 POL-00002' }).getAttribute('href')).toBe('/policies/POL-00002');
    const changes = screen.getByTestId('gl-changes');
    expect(await within(changes).findByRole('link', { name: SOURCE.path })).toBeTruthy();
    expect(within(changes).getByText('SW-CARE-SDIST-APP@1.2.1')).toBeTruthy();
    expect(document.querySelector('img[data-system="gitlab"]')!.getAttribute('src')).toBe('/brand/gitlab-logo.svg');
    // 목록에서 다른 MR을 고르면 그 MR의 판정 상태(commit status)와 연결로 바뀐다
    traceMrs = ['vehicle/feature-sw!146'];
    fireEvent.click(screen.getByRole('button', { name: /FEAT-00144@3\.3\.0/ }));
    expect(await screen.findByText('ff/gate-G8')).toBeTruthy();
    expect(await within(screen.getByTestId('gl-linked')).findByRole('link', { name: /FEAT-00144@3\.3\.0/ })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get('feature')).toBeNull();
  });

  it('연계 원장에 없는 MR은 제목의 Feature 참조만으로 연결하지 않는다', async () => {
    traceMrs = [];
    window.history.replaceState(null, '', '/external.html?system=gitlab&key=vehicle%2Ffeature-sw%21117');
    render(<ExternalApp />);
    expect(await within(await screen.findByTestId('gl-linked')).findByText(/연결과 맞지 않습니다/)).toBeTruthy();
    expect(within(screen.getByTestId('gl-linked')).queryByRole('link')).toBeNull();
  });

  it('변경 파일은 Flag 소스·SW 구성요소로 채우고, 둘 다 없으면 병합 커밋을 보인다', () => {
    const item = mr(117, 'FEAT-00022@1.0.0');
    expect(featureCandidate(item, null)).toEqual({ featureId: 'FEAT-00022', version: '1.0.0' });
    expect(featureCandidate(item, 'FEAT-00144@3.3.0')).toEqual({ featureId: 'FEAT-00144', version: '3.3.0' });
    expect(mrChanges(item, [], null)).toEqual([{ kind: 'commit', label: SHA.slice(0, 12), note: '병합 커밋' }]);
    expect(mrChanges(item, [], { featureId: 'FEAT-00022', version: '1.0.0', name: 'x', lifecycle: 'RELEASED', swIds: ['SW-A'], swVersions: ['1.0.0'], ecuPnos: ['E-1'] }).map((c) => c.label)).toEqual(['SW-A@1.0.0']);
  });
});
