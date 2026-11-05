import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import ReadOnlyOperationOverview from '../screens/home/dashboard/ReadOnlyOperationOverview';
import ChartBody from '../screens/home/dashboard/bodies-charts';
import { buildOperationModel, receivedState, UNKNOWN_GROUP, type OperationInput } from '../screens/home/dashboard/operation-overview-model';
import { operationOverview as O } from '../copy/operation-overview';
import { dashboard } from '../copy/dashboard';

const flag = (value: boolean, reason = 'MATCH') => ({ flagKey: 'flag_a', publicationId: 'PUB-00001', sequence: 1, local: { value, reason }, drift: false });
const INPUT: OperationInput = {
  runtime: [
    { vin: 'V1', scope: 'KR/NX4/Premium', quality: 'TRUSTED', link: 'ONLINE', flags: [flag(true)], last: null },
    { vin: 'V2', scope: 'KR/NX4/Premium', quality: 'TRUSTED', link: 'OFFLINE', flags: [flag(false)], last: null },
    { vin: 'V3', scope: 'EU/GN7/Wide', quality: 'TRUSTED', link: 'ONLINE', flags: [], last: null },
    { vin: 'V4', scope: 'KR/EV/Premium', quality: 'TRUSTED', link: 'ONLINE', flags: [flag(false, 'KILL_SWITCH')], last: null },
    { vin: 'V5', scope: 'missing', quality: 'UNTRUSTED', link: 'OFFLINE', flags: [flag(true)], last: null },
  ],
  vehicles: [{ vin: 'V1', country: 'KR', vehicleModel: 'NX4' }, { vin: 'V2', country: 'KR', vehicleModel: 'NX4' }, { vin: 'V3', country: 'EU', vehicleModel: 'GN7' }, { vin: 'V4', country: 'KR', vehicleModel: 'EV' }, { vin: 'V5' }],
  features: [{ featureId: 'F1', version: '1.0.0', country: 'KR', vehicleModel: 'NX4' }, { featureId: 'F2', version: '2.0.0', country: 'EU', vehicleModel: 'GN7' }],
  policies: [
    { policyId: 'POL-00001', revision: 4, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_a', status: 'DEPLOYED' },
    { policyId: 'POL-00002', revision: 1, featureId: 'F2', featureVersion: '2.0.0', flagKey: 'flag_b', status: 'VALIDATED' },
    { policyId: 'POL-00003', revision: 1, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'pending_a', status: 'VALIDATED' },
  ],
  publications: [
    { publicationId: 'PUB-00001', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-05T01:00:00Z', payload: { targets: ['V1', 'V2', 'V4'], flagKey: 'flag_a', featureId: 'F1', policy: { policyId: 'POL-00001', revision: 3 } } },
    { publicationId: 'PUB-00002', kind: 'POLICY', status: 'DIVERGED', createdAt: '2026-11-05T02:00:00Z', payload: { targets: ['V2'], flagKey: 'flag_a', featureId: 'F1', policy: { policyId: 'POL-00001', revision: 4 } } },
    { publicationId: 'PUB-00003', kind: 'POLICY', status: 'DISPATCHED', createdAt: '2026-11-05T03:00:00Z', payload: { targets: ['V3'], flagKey: 'flag_b', featureId: 'F2', policy: { policyId: 'POL-00002', revision: 1 } } },
    { publicationId: 'PUB-00004', kind: 'KILL', status: 'CONFIRMED', createdAt: '2026-11-05T02:10:00Z', payload: { targets: ['V4'], flagKey: null, featureId: 'F1', policy: null } },
  ],
  readbacks: [
    { vin: 'V1', publicationId: 'PUB-00001', at: '2026-11-05T01:05:00Z', metricType: 'READBACK', observed: 'policy-hash-r3' },
    { vin: 'V2', publicationId: 'PUB-00002', at: '2026-11-05T02:01:00Z', metricType: 'READBACK', observed: 'REJECTED', rejectReason: 'SIGNATURE_INVALID' },
    { vin: 'V2', publicationId: 'PUB-00002', at: '2026-11-05T02:02:00Z', metricType: 'ACK', observed: 'ACK' },
    { vin: 'V3', publicationId: 'PUB-00003', at: 'invalid-time', metricType: 'READBACK', observed: 'policy-hash-r1' },
    { vin: 'V4', publicationId: 'PUB-00004', at: '2026-11-05T02:11:00Z', metricType: 'READBACK', observed: 'SAFE_DEFAULT' },
  ],
  syncs: [
    { at: '2026-11-05T01:10:00Z', request: { policyId: 'POL-00001', revision: 3, mode: 'live' }, response: { outcome: 'SYNCED' } },
    { at: '2026-11-05T02:03:00Z', request: { policyId: 'POL-00001', revision: 4, mode: 'live' }, response: { outcome: 'FAILED' } },
    { at: '2026-11-05T00:10:00Z', request: { policyId: 'POL-00001', revision: 0, mode: 'mock' }, response: { outcome: 'SYNCED' } },
  ],
};
const ALL = { country: '', model: '', flag: '' };
const metric = (key: string) => document.querySelector(`[data-metric="${key}"] dd`)!;
let reply: (url: string) => { body: unknown; status?: number };
const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
beforeEach(() => {
  localStorage.clear(); calls.length = 0;
  reply = (url) => ({ body: { items: url.startsWith('/api/fleet/runtime') ? INPUT.runtime : url.startsWith('/api/vehicles') ? INPUT.vehicles : url.startsWith('/api/policies') ? INPUT.policies : url.startsWith('/api/features') ? INPUT.features : url.startsWith('/api/publications') ? INPUT.publications : url.startsWith('/api/telemetry/readbacks') ? INPUT.readbacks : url.startsWith('/api/integrations/calls') ? INPUT.syncs : [] } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> }); const r = reply(String(url)); return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } }); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(ui: JSX.Element, role = 'operator') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role, department: 'ALL' }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider>{ui}</AppProvider></MemoryRouter></QueryClientProvider>);
}

describe('actual vehicle receipt aggregation', () => {
  it('never infers ON from a deployed policy, missing bundle or untrusted received value', () => {
    expect(INPUT.runtime.map((r) => receivedState(r, ''))).toEqual(['ON', 'OFF', 'UNKNOWN', 'SAFE', 'UNKNOWN']);
    expect(receivedState(INPUT.runtime[0], 'flag_b')).toBe('UNKNOWN');
    const model = buildOperationModel(INPUT, ALL);
    expect(model.received).toBe(3); expect(model.unknown).toBe(2); expect(model.deployed).toBe(1); expect(model.approvals).toBe(2);
    expect(model.countryGroups.reduce((n, g) => n + g.total, 0)).toBe(5);
  });

  it('uses the same country/model/flag scope for vehicles, policy counts and receipt history', () => {
    const model = buildOperationModel(INPUT, { country: 'KR', model: 'NX4', flag: 'flag_a' });
    expect(model.rows.map((r) => r.runtime.vin)).toEqual(['V1', 'V2']);
    expect(model.deployed).toBe(1); expect(model.approvals).toBe(0); expect(model.rejected).toBe(1);
    expect(model.countryGroups.map((g) => [g.name, g.total])).toEqual([['KR', 2]]);
    expect(model.modelGroups.map((g) => [g.name, g.total])).toEqual([['NX4', 2]]);
    expect(model.events.some((e) => e.label.includes('V3'))).toBe(false);
  });

  it('keeps the actual held revision separate from a newer rejected readback and excludes ACK', () => {
    const model = buildOperationModel(INPUT, ALL);
    const v2 = model.rows.find((r) => r.runtime.vin === 'V2')!;
    expect(model.publicationById.get(v2.flags[0].publicationId!)?.payload.policy?.revision).toBe(3);
    expect(v2.readback?.publicationId).toBe('PUB-00002');
    expect(v2.readback?.at).toBe('2026-11-05T02:01:00Z');
    expect(model.events.filter((e) => e.phase === 'SYNC').map((e) => e.label)).toEqual(['POL-00001@r3 SYNCED (live)', 'POL-00001@r4 FAILED (live)']);
    expect(model.invalidTimes).toBe(1);
    expect(model.events.every((e) => Number.isFinite(Date.parse(e.at)))).toBe(true);
  });

  it('an unknown metadata group selects unknown vehicles rather than silently clearing the filter', () => {
    const model = buildOperationModel(INPUT, { ...ALL, country: UNKNOWN_GROUP });
    expect(model.rows.map((r) => r.runtime.vin)).toEqual(['V5']);
    expect(model.countryGroups[0].name).toBe(UNKNOWN_GROUP);
  });

  it('keeps reversed source times visible and matches sync evidence by exact policy and revision', () => {
    const wrongPolicy = { at: '2026-11-05T00:59:00Z', request: { policyId: 'POL-99999', revision: 3, mode: 'live' }, response: { outcome: 'SYNCED' } };
    const model = buildOperationModel({ ...INPUT, syncs: [...INPUT.syncs, wrongPolicy] }, ALL);
    expect(model.preparationIssues).toEqual([
      { publicationId: 'PUB-00001', policyId: 'POL-00001', revision: 3, reason: 'SYNC_LATE' },
      { publicationId: 'PUB-00002', policyId: 'POL-00001', revision: 4, reason: 'SYNC_UNKNOWN' },
      { publicationId: 'PUB-00003', policyId: 'POL-00002', revision: 1, reason: 'SYNC_UNKNOWN' },
    ]);
    expect(model.events.find((e) => e.label === 'PUB-00001')?.at).toBe('2026-11-05T01:00:00Z');
    expect(model.events.find((e) => e.phase === 'SYNC' && e.label.includes('@r3'))?.at).toBe('2026-11-05T01:10:00Z');
    const before = { ...wrongPolicy, request: { ...wrongPolicy.request, policyId: 'POL-00001' } };
    expect(buildOperationModel({ ...INPUT, syncs: [...INPUT.syncs, before] }, ALL).preparationIssues.some((i) => i.publicationId === 'PUB-00001')).toBe(false);
    const badTime = { ...before, at: 'invalid-time' };
    expect(buildOperationModel({ ...INPUT, syncs: [badTime] }, ALL).preparationIssues.find((i) => i.publicationId === 'PUB-00001')?.reason).toBe('TIME_UNKNOWN');
  });
});

describe('operation overview, read only', () => {
  it('shows sync → vehicle publication preparation → receipt while keeping missing sync lookup unknown', async () => {
    mount(<ReadOnlyOperationOverview role="operator" />);
    await screen.findByRole('table', { name: O.table });
    const timeline = screen.getByRole('region', { name: O.timeline });
    await waitFor(() => expect(within(timeline).getByRole('group', { name: O.timeline })).toBeTruthy());
    const svg = within(timeline).getByRole('group', { name: O.timeline });
    const labels = Array.from(svg.querySelectorAll('text')).map((el) => el.textContent).filter((value) => Object.values(O.phase).includes(value!));
    expect(labels).toEqual([O.phase.SYNC, O.phase.DEPLOY, O.phase.READBACK]);
    expect(timeline.textContent).toContain(O.timelineBasis);
    const preparation = screen.getByRole('region', { name: O.preparation });
    expect(preparation.textContent).toContain(O.preparationPending(3));
    expect(preparation.textContent).toContain(O.preparationReason.SYNC_LATE);
    expect(preparation.textContent).toContain(O.preparationReason.SYNC_UNKNOWN);
    expect(within(preparation).getByRole('link', { name: 'PUB-00001 · POL-00001@r3', hidden: true }).getAttribute('href')).toBe('/deployments/PUB-00001');
    cleanup();
    const base = reply;
    reply = (url) => url.startsWith('/api/integrations/calls') ? { status: 503, body: { error: { message: 'sync records unavailable' } } } : base(url);
    mount(<ReadOnlyOperationOverview role="operator" />);
    await screen.findByRole('table', { name: O.table });
    expect(await screen.findByText(O.syncUnavailable)).toBeTruthy();
    expect(screen.getByRole('region', { name: O.preparation }).querySelector('details')).toBeNull();
    expect(screen.getByRole('region', { name: O.timeline }).textContent).toContain(O.restricted);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('synchronizes country/model chart selection, KPIs and the vehicle table, retaining real drill links', async () => {
    mount(<ReadOnlyOperationOverview role="operator" />);
    await screen.findByRole('table', { name: O.table });
    await waitFor(() => expect(metric('approvals').getAttribute('aria-busy')).toBe('false'));
    expect(metric('vehicles').textContent).toBe('5'); expect(metric('unknown').textContent).toBe('2');
    expect(metric('received').textContent).toBe('60%3/5대');
    fireEvent.click(within(screen.getByRole('region', { name: O.countryChart })).getByRole('button', { name: 'KR 3대 차량 보기' }));
    expect((screen.getByLabelText(O.country) as HTMLSelectElement).value).toBe('KR');
    expect(metric('vehicles').textContent).toBe('3');
    fireEvent.click(within(screen.getByRole('region', { name: O.modelChart })).getByRole('button', { name: 'NX4 2대 차량 보기' }));
    expect(metric('vehicles').textContent).toBe('2');
    fireEvent.change(screen.getByLabelText(O.flag), { target: { value: 'flag_a' } });
    const table = screen.getByRole('table', { name: O.table });
    const row = within(table).getByRole('link', { name: 'V2' }).closest('tr')!;
    expect(within(row).getByText('POL-00001 · r3')).toBeTruthy();
    expect(row.textContent).toContain('SIGNATURE_INVALID');
    expect(within(row).getByRole('link', { name: 'V2' }).getAttribute('href')).toBe('/fleet/vehicles/V2');
    expect(screen.getByRole('link', { name: O.map }).getAttribute('href')).toBe('/fleet/map?lens=activation&flagKey=flag_a');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.find((c) => c.url.startsWith('/api/telemetry/readbacks'))?.headers['X-Actor-Role']).toBe('OPERATOR');
  });

  it('does not render a synthetic time series when every source has no events', async () => {
    reply = (url) => ({ body: { items: url.startsWith('/api/fleet/runtime') ? INPUT.runtime : url.startsWith('/api/vehicles') ? INPUT.vehicles : [] } });
    mount(<ReadOnlyOperationOverview role="operator" />);
    await screen.findByRole('table', { name: O.table });
    await waitFor(() => expect(metric('rejected').getAttribute('aria-busy')).toBe('false'));
    const timeline = screen.getByRole('region', { name: O.timeline });
    expect(timeline.querySelector('svg')).toBeNull();
    expect(timeline.textContent).toContain(O.noEvents);
    expect(timeline.textContent).not.toContain('Invalid Date');
  });

  it('does not turn an empty vehicle denominator into a successful receipt rate', async () => {
    reply = () => ({ body: { items: [] } });
    mount(<ReadOnlyOperationOverview role="operator" />);
    await screen.findByRole('table', { name: O.table });
    expect(metric('received').textContent).toBe('—0/0대');
    expect(screen.getByText(O.noRuntime)).toBeTruthy();
  });

  it('keeps optional telemetry failure unknown instead of reporting zero rejections', async () => {
    const base = reply;
    reply = (url) => url.startsWith('/api/telemetry/readbacks') ? { status: 503, body: { error: { message: 'telemetry unavailable' } } } : base(url);
    mount(<ReadOnlyOperationOverview role="operator" />);
    await screen.findByText(O.unavailable);
    expect(metric('rejected').textContent).toBe('—');
    expect(metric('vehicles').textContent).toBe('5');
    expect(screen.getByRole('region', { name: O.timeline }).textContent).toContain(O.restricted);
  });

  it('does not fetch protected readbacks for a role without safety-operation access', async () => {
    mount(<ReadOnlyOperationOverview role="commerce" />, 'commerce');
    await screen.findByRole('table', { name: O.table });
    expect(screen.getByText(O.noAccess)).toBeTruthy();
    expect(calls.some((c) => c.url.startsWith('/api/telemetry/readbacks'))).toBe(false);
    expect(metric('rejected').textContent).toBe('—');
  });

  it('rejects malformed core runtime data without manufacturing a zero-vehicle success', async () => {
    const base = reply;
    reply = (url) => url.startsWith('/api/fleet/runtime') ? { body: { items: [{}] } } : base(url);
    mount(<ReadOnlyOperationOverview role="operator" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(O.badData);
    expect(document.querySelector('[data-metric="vehicles"]')).toBeNull();
    expect(screen.getByRole('button', { name: O.refresh })).toBeTruthy();
  });

  it('preserves the existing chart data and legend drill, with a real donut total', async () => {
    reply = () => ({ body: { items: [{ featureId: 'FEAT-00001', version: '1.0.0', name: 'A', country: 'KR' }, { featureId: 'FEAT-00002', version: '1.0.0', name: 'B', country: 'KR' }, { featureId: 'FEAT-00003', version: '1.0.0', name: 'C', country: 'EU' }] } });
    mount(<ChartBody role="operator" wide={false} gadget={{ id: 'pie-test', type: 'pie', configured: true, config: { source: 'features', groupBy: 'country' }, refresh: 0, minimized: false } as any} />);
    await waitFor(() => expect(document.querySelector('.jd-pie__total')?.textContent).toBe('3'));
    const kr = screen.getByRole('button', { name: /KR.*2.*66.7/ });
    fireEvent.click(kr);
    expect(await screen.findByRole('button', { name: dashboard.board.body.backToChart })).toBeTruthy();
  });

  it('an empty created/resolved gadget shows no-data text without a flat invented series', async () => {
    reply = () => ({ body: { items: [] } });
    mount(<ChartBody role="operator" wide={false} gadget={{ id: 'trend-test', type: 'createdResolved', configured: true, config: { source: 'anomalies', days: 30 }, refresh: 0, minimized: false } as any} />);
    expect(await screen.findByText(dashboard.board.body.noTrend)).toBeTruthy();
    expect(document.querySelector('.jd-trend')).toBeNull();
  });
});
