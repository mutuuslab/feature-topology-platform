// 회귀: 헤드라인(핵심 메시지)이 아래 데이터와 모순되면 안 된다(UI 하네스 2판 결함 3·4, 2026-10-23).
// - 기록이 0건인데 초록(ok)이면 '정상'으로 읽힌다 → neutral
// - 표에 FAIL·검토 중·보류가 보이는데 초록이면 모순 → warn
// - "0 · 4"처럼 라벨 없는 숫자 쌍은 해독할 수 없다 → 합계 숫자 + 라벨 문장
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { TelemetryScreen } from '../screens/master/Ops';
import { ValidationHistory } from '../screens/policy/Policies';
import { FeedbackScreen } from '../screens/ops/Anomalies';
import { DataSyncScreen, IntegrationsScreen } from '../screens/ext/Integrations';
import { AuditScreen } from '../screens/governance/AuditEvents';
import Precheck from '../screens/governance/Precheck';

type Handler = (url: string) => unknown;
let handler: Handler;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = handler(url);
    return new Response(JSON.stringify(body ?? { error: { code: 'NOT_FOUND', message: url } }), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
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

/** 데이터가 도착해 판정이 바뀔 때까지 기다린다(불러오는 중엔 neutral) */
const keyOf = async (tone: string, settled?: string) => {
  await waitFor(() => {
    const k = document.querySelector('[data-key-message]');
    expect(k?.getAttribute('data-tone')).toBe(tone);
    // 불러오는 중에도 neutral이다 — 값이 '—'가 아니고(settled가 있으면 그 문구까지) 나와야 데이터 판정이다
    expect(k?.textContent).not.toMatch(/^—/);
    if (settled) expect(k?.textContent).toContain(settled);
  });
  return document.querySelector('[data-key-message]')!.textContent ?? '';
};

describe('헤드라인과 데이터가 맞는다', () => {
  it('운영 데이터 — 표에 거부(rejectReason) 행이 있으면 초록이 아니다', async () => {
    handler = (url) => (url.startsWith('/api/telemetry/readbacks') ? { items: [{ vin: 'ego-01', publicationId: 'PUB-00001', metricType: 'READBACK', observed: 'sha256:abc', at: '2026-10-12T01:00:00.000Z', rejectReason: 'SIG_MISMATCH' }] } : url.startsWith('/api/vehicles') ? { items: [] } : undefined);
    mount('/ops/telemetry', <TelemetryScreen />);
    expect(await keyOf('warn')).toContain('1');
  });

  it('검증 이력 — 기록이 0건이면 초록 대신 neutral', async () => {
    handler = (url) => (url.startsWith('/api/policies/validations') ? { items: [] } : undefined);
    mount('/validations', <ValidationHistory />);
    expect(await keyOf('neutral', '아직 검증 기록이 없습니다')).toContain('0');
  });

  it('품질 피드백 — 검토 중(ACCEPTED)만 있어도 열린 피드백으로 센다', async () => {
    handler = (url) => (url.startsWith('/api/quality-feedback') ? { items: [{ feedbackId: 'QF-1', featureId: 'FEAT-00022', featureVersion: '1.0.0', anomalyId: 'AN-00001', actions: [{ ref: 'REVALIDATE' }], status: 'ACCEPTED', createdAt: '2026-10-12T01:00:00.000Z' }] } : undefined);
    mount('/quality/feedback', <FeedbackScreen />);
    expect(await keyOf('warn')).toContain('1');
  });

  it('데이터 동기화 — 게이트 보류 대상이 있으면 초록이 아니다', async () => {
    handler = (url) =>
      url.startsWith('/api/sync/targets')
        ? { items: [{ targetId: 'ST-1', system: 'DATALAKE', market: 'CN', gate: { allowed: false, reason: '국외 이전 보류' }, last: { status: 'SUCCEEDED', at: '2026-10-12T01:00:00.000Z', by: 'sys', records: { platform: 1, external: 1 }, diffs: [], reason: null } }] }
        : undefined;
    mount('/integration/sync', <DataSyncScreen />);
    expect(await keyOf('warn')).toContain('1');
  });

  it('외부 연계 — 한 번도 주고받지 않았으면 초록("맞습니다") 대신 neutral', async () => {
    handler = (url) =>
      url === '/api/integrations/sync'
        ? { items: [{ system: 'JIRA', ifId: 'IF-14', mode: 'mock', links: 0, conflicts: 0, failed: 0, pending: 0, rejected: 0, lastInboundAt: null, lastOutboundAt: null }] }
        : url.startsWith('/api/integrations/systems')
          ? { items: [] }
          : undefined;
    mount('/integration/connectors', <IntegrationsScreen />);
    expect(await keyOf('neutral', '아직 외부와 주고받은 변경이 없습니다')).toBeTruthy();
  });

  it('감사 이력 — 체인이 정상이어도 FAILED 행이 있으면 warn', async () => {
    handler = (url) =>
      url.startsWith('/api/audit/chain')
        ? { ok: true, verified: 3, head: 'h', broken: null }
        : url.startsWith('/api/audit')
          ? { items: [{ id: 3, at: '2026-10-12T01:00:00.000Z', actorId: 'kim', action: 'policy.approve', target: 'POL-00001', result: 'FAILED', reason: 'x', correlationId: 'c' }] }
          : undefined;
    mount('/audit', <AuditScreen />);
    expect(await keyOf('warn')).toContain('실패'); // 필터·결과 열과 같은 낱말(UX3-02)
  });

  it('사전점검 — "0 · 4" 대신 합계 숫자와 FAIL·CONDITIONAL 라벨', async () => {
    handler = (url) => (url.startsWith('/api/precheck') ? { ruleVersion: 'DATA-PRECHECK-1', summary: { PASS: 12, FAIL: 0, CONDITIONAL: 4, dataQualityFindings: 0 }, rules: [], dataQuality: [] } : undefined);
    mount('/precheck', <Precheck />);
    const text = await keyOf('warn');
    expect(text).not.toContain('0 · 4');
    expect(text).toContain('FAIL 0 · CONDITIONAL 4');
  });
});
