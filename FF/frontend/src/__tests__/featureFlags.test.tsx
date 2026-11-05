// Git 제출 기록·정책과 실제 회신의 구분·담당자 가져오기 권한을 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { FeatureFlagRow } from '@ff/contracts';
import { AppProvider } from '../store';
import { FeatureFlagsTab, FeatureFlagHighlight } from '../screens/features/FeatureFlags';
import { flags as T } from '../copy/flags';
import { flagPublicationEvidence } from '../screens/features/flag-publication';

const COMMIT = '1160d92de3af1a9cbaadc7241c2fa09baee39d4b';
const source = { repository: 'https://github.com/mutuuslab/feature-topology-platform', provider: 'GITHUB' as const, commit: COMMIT, path: 'FF/examples/feature-flag-consumer/distance.ts', line: 8, symbol: 'client.getBooleanValue', method: 'getBooleanValue' as const, safeDefault: 'EXPLICIT_FALSE' as const, contentHash: 'sha256:' + 'a'.repeat(64), url: `https://github.com/mutuuslab/feature-topology-platform/blob/${COMMIT}/FF/examples/feature-flag-consumer/distance.ts#L8`, importedAt: '2026-11-05T01:00:00.000Z', importedBy: 'usr-integrator', provenance: 'CI_IMPORT' as const };
const row: FeatureFlagRow = { flagKey: 'care_00022_signal', featureId: 'FEAT-00022', version: '1.0.0', featureName: '차간 거리', policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 2, controlPoint: 'Signal' }, sources: [source], publication: null };
let body: unknown;
let status = 200;
let posted: { body: unknown; role?: string }[];
let publicationBody: unknown;
const detail = () => ({ publication: { publicationId: 'PUB-00001', kind: 'POLICY', createdAt: '2026-11-05T01:00:00.000Z', status: 'PARTIAL', confirmed: 1, denominator: 2, payload: { publicationId: 'PUB-00001', featureId: row.featureId, featureVersion: row.version, flagKey: row.flagKey, policy: { policyId: row.policy!.policyId, revision: row.policy!.revision }, targets: ['VIN-A', 'VIN-B'] } }, verification: { valid: true }, readbacks: [{ publicationId: 'PUB-00001', vin: 'VIN-A', at: '2026-11-05T01:02:00.000Z', observed: 'ON' }] });
beforeEach(() => {
  localStorage.clear(); body = [row]; status = 200; posted = []; publicationBody = detail();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ body: JSON.parse(String(init.body)), role: (init.headers as Record<string, string>)['X-Actor-Role'] });
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '구현 담당자 권한을 다시 확인하세요.' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(_url.startsWith('/api/publications/') ? publicationBody : body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(role = 'integrator', highlight = false) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/policies/POL-00001']}><AppProvider>{highlight ? <FeatureFlagHighlight id="FEAT-00022" ver="1.0.0" /> : <FeatureFlagsTab id="FEAT-00022" ver="1.0.0" />}</AppProvider></MemoryRouter></QueryClientProvider>);
}

describe('Feature Flag 연결', () => {
  it('실제 커밋·소스 줄을 열고, 정책 배포 상태만으로 차량 확인을 표시하지 않는다', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: row.flagKey })).toBeVisible();
    expect(screen.getByRole('link', { name: /distance.ts:8/ })).toHaveAttribute('href', source.url);
    expect(screen.getByText(T.noPublication)).toBeVisible();
    expect(document.querySelectorAll('.ff-flow > li')).toHaveLength(5);
    expect(document.querySelector('[data-flag-stage="evaluation"]')).toHaveTextContent('3 · Unleash 평가');
    expect(document.querySelector('[data-flag-stage="delivery"]')).toHaveTextContent('4 · 차량 배포');
    expect(document.querySelector('[data-flag-stage="receipt"]')).toHaveTextContent('5 · 차량으로부터 수신');
    expect(screen.queryByText(T.publication.CONFIRMED)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /동기화·차량별 평가 확인/ })).toHaveAttribute('href', '/policies/POL-00001#unleash-h');
    expect(screen.getByText(T.safe.EXPLICIT_FALSE)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Flag 적용 차량 지도 →' })).toHaveAttribute('href', '/fleet/map?lens=activation&flagKey=care_00022_signal');
  });
  it('일부 회신 분자를 그대로 보여 주고 실제 배포 화면으로 연결한다', async () => {
    body = [{ ...row, publication: { publicationId: 'PUB-00001', status: 'PARTIAL', confirmed: 1, denominator: 2 } }];
    mount('viewer');
    expect(await screen.findByRole('link', { name: '서명·배포 근거 확인 →' })).toHaveAttribute('href', '/deployments/PUB-00001');
    const receipt = document.querySelector('[data-flag-stage="receipt"]') as HTMLElement;
    expect(await within(receipt).findByText('일치 회신 1/2')).toBeVisible();
    expect(receipt).toHaveTextContent('2026-11-05 10:02');
    expect(within(receipt).getByRole('link', { name: 'VIN-A' })).toHaveAttribute('href', '/fleet/vehicles/VIN-A');
    expect(within(receipt).queryByText(/10:00/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.import })).toBeDisabled();
  });
  it('이전 정책 개정이나 다른 게시본의 시각·VIN을 현재 수신으로 표시하지 않는다', async () => {
    body = [{ ...row, publication: { publicationId: 'PUB-00001', status: 'PARTIAL', confirmed: 1, denominator: 2 } }];
    const stale = detail(); stale.publication.payload.policy.revision = 1; publicationBody = stale;
    mount();
    expect(await screen.findByText('현재 정책·게시본의 서명 근거를 다시 확인하세요.')).toBeVisible();
    expect(screen.queryByText('일치 회신 1/2')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'VIN-A' })).not.toBeInTheDocument();
  });
  it('서명 게시본만 있고 차량 미수신이면 생성 시각을 수신 시각으로 채우지 않는다', async () => {
    body = [{ ...row, publication: { publicationId: 'PUB-00001', status: 'SIGNED', confirmed: 0, denominator: 2 } }];
    const waiting = detail(); waiting.publication.status = 'SIGNED'; waiting.publication.confirmed = 0; waiting.readbacks = []; publicationBody = waiting;
    mount();
    await screen.findByRole('heading', { name: row.flagKey });
    const receipt = document.querySelector('[data-flag-stage="receipt"]') as HTMLElement;
    expect(await within(receipt).findByText('차량으로부터 수신된 기록이 없습니다.')).toBeVisible();
    expect(receipt).not.toHaveTextContent('2026-11-05 10:00');
    expect(within(receipt).queryByRole('link', { name: 'VIN-A' })).not.toBeInTheDocument();
  });
  it('무효 서명·다른 게시본·대상 외 VIN의 수신을 근거로 붙이지 않는다', () => {
    const bound = { ...row, publication: { publicationId: 'PUB-00001', status: 'PARTIAL' as const, confirmed: 1, denominator: 2 } };
    const badSignature = detail(); badSignature.verification.valid = false;
    expect(flagPublicationEvidence(bound, badSignature)).toBeNull();
    const other = detail(); other.publication.publicationId = 'PUB-00002';
    expect(flagPublicationEvidence(bound, other)).toBeNull();
    const unrelated = detail(); unrelated.readbacks.push({ publicationId: 'PUB-00002', vin: 'VIN-A', at: '2026-11-05T02:00:00.000Z', observed: 'ON' }, { publicationId: 'PUB-00001', vin: 'VIN-C', at: '2026-11-05T03:00:00.000Z', observed: 'ON' });
    expect(flagPublicationEvidence(bound, unrelated)?.latest).toMatchObject({ vin: 'VIN-A', at: '2026-11-05T01:02:00.000Z' });
  });
  it('정책 화면의 강조 링크도 해당 Feature Flag 탭으로 이동한다', async () => {
    mount('viewer', true);
    expect(await screen.findByRole('link', { name: T.open + ' →' })).toHaveAttribute('href', '/features/FEAT-00022/1.0.0?tab=flags');
    expect(screen.getByRole('link', { name: /care_00022_signal/ })).toHaveAttribute('href', '/features/FEAT-00022/1.0.0?tab=flags#flag-care_00022_signal');
  });
  it('깨진 응답과 서버 오류를 빈 연결이나 성공으로 바꾸지 않는다', async () => {
    body = [{ flagKey: 'broken', sources: [null] }];
    mount();
    expect(await screen.findByText(T.malformed)).toBeVisible();
    expect(screen.queryByText(T.none)).not.toBeInTheDocument();
  });
  it('잘못된 JSON을 보내지 않고, 쓰기403 뒤 입력을 보존하며 성공으로 표시하지 않는다', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: T.import }));
    const input = screen.getByRole('textbox', { name: T.importLabel });
    fireEvent.change(input, { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: T.importSubmit }));
    expect(screen.getByText(T.invalid)).toBeVisible(); expect(posted).toHaveLength(0);
    fireEvent.change(input, { target: { value: '{"format":"ff-flag-source/v1"}' } });
    fireEvent.click(screen.getByRole('button', { name: T.importSubmit }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].role).toBe('IMPLEMENTER');
    expect(await screen.findByText('구현 담당자 권한을 다시 확인하세요.')).toBeVisible();
    expect(input).toHaveValue('{"format":"ff-flag-source/v1"}');
    expect(screen.queryByText(T.importDone)).not.toBeInTheDocument();
  });
});
