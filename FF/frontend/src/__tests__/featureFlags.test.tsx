// Git 제출 기록·정책과 실제 회신의 구분·담당자 가져오기 권한을 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { FeatureFlagRow } from '@ff/contracts';
import { AppProvider } from '../store';
import { FeatureFlagsTab, FeatureFlagHighlight } from '../screens/features/FeatureFlags';
import { flags as T } from '../copy/flags';

const COMMIT = '1160d92de3af1a9cbaadc7241c2fa09baee39d4b';
const source = { repository: 'https://github.com/mutuuslab/feature-topology-platform', provider: 'GITHUB' as const, commit: COMMIT, path: 'FF/examples/feature-flag-consumer/distance.ts', line: 8, symbol: 'client.getBooleanValue', method: 'getBooleanValue' as const, safeDefault: 'EXPLICIT_FALSE' as const, contentHash: 'sha256:' + 'a'.repeat(64), url: `https://github.com/mutuuslab/feature-topology-platform/blob/${COMMIT}/FF/examples/feature-flag-consumer/distance.ts#L8`, importedAt: '2026-11-05T01:00:00.000Z', importedBy: 'usr-integrator', provenance: 'CI_IMPORT' as const };
const row: FeatureFlagRow = { flagKey: 'care_00022_signal', featureId: 'FEAT-00022', version: '1.0.0', featureName: '차간 거리', policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 2, controlPoint: 'Signal' }, sources: [source], publication: null };
let body: unknown;
let status = 200;
let posted: { body: unknown; role?: string }[];
beforeEach(() => {
  localStorage.clear(); body = [row]; status = 200; posted = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ body: JSON.parse(String(init.body)), role: (init.headers as Record<string, string>)['X-Actor-Role'] });
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '구현 담당자 권한을 다시 확인하세요.' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    expect(screen.queryByText(T.publication.CONFIRMED)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /동기화·차량별 평가 확인/ })).toHaveAttribute('href', '/policies/POL-00001#unleash-h');
    expect(screen.getByText(T.safe.EXPLICIT_FALSE)).toBeVisible();
  });
  it('일부 회신 분자를 그대로 보여 주고 실제 배포 화면으로 연결한다', async () => {
    body = [{ ...row, publication: { publicationId: 'PUB-00001', status: 'PARTIAL', confirmed: 1, denominator: 2 } }];
    mount('viewer');
    expect(await screen.findByRole('link', { name: '일부 회신 · 1/2' })).toHaveAttribute('href', '/deployments');
    expect(screen.getByRole('button', { name: T.import })).toBeDisabled();
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
