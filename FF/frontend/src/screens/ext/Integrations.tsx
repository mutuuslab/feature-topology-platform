// /integration/connectors — 외부 연계 현황 (D05-01): IF-01~13 연결 방식·호출, IF-01 ALM 요구사항, IF-08 협력사 납품, IF-11 OTel span, 호출 기록.
// /integration/sync — 데이터 동기화 (D05-02): 대상별 시장·방향·이전 심사, 대사 실행·차이.
// /integration/legacy — Legacy 연계 (D05-03) + Legacy-SDV (D05-07).
import { useState } from 'react';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, PageHeader, Panel, Select, Tabs, Toolbar, VerdictBadge } from '../../design';
import { usePermission } from '../shared';
import { extSync } from '../../copy/ext-sync';
import { ExtSyncTab } from './ExtSyncTab';

const G = ko.p10.integrations;
const S = ko.p10.sync;
const L = ko.p10.legacy;

interface SystemRow {
  ifId: string;
  name: string;
  mode: string;
  adapter: string;
  components: string[];
  calls: number;
  lastAt: string | null;
}

export function IntegrationsScreen() {
  const sys = useApi<{ items: SystemRow[] }>('integrationSystems');
  const sync = useApi<{ items: { conflicts: number; failed: number; lastInboundAt: string | null; lastOutboundAt: string | null }[] }>('extSync');
  const items = sys.data?.items ?? [];
  const mock = items.filter((s) => s.mode === 'mock').length;
  const attention = (sync.data?.items ?? []).reduce((t, x) => t + x.conflicts + x.failed, 0);
  // 한 번도 주고받지 않았으면 '맞습니다'(초록)는 근거가 없다 — neutral
  const exchanged = (sync.data?.items ?? []).some((x) => x.lastInboundAt || x.lastOutboundAt);
  return (
    <div className="ds-screen">
      <PageHeader codes="D05-01 · IF-01~14" title={G.title} lead={G.lead} message={!sync.data ? { tone: 'neutral', value: '—', text: extSync.sync.key.ok } : attention ? { tone: 'warn', value: attention, text: extSync.sync.key.attention } : !exchanged ? { tone: 'neutral', text: extSync.sync.key.idle } : { tone: 'ok', text: extSync.sync.key.ok }}
        meta={sys.data ? G.key(mock, items.length - mock) : undefined} />
      <Tabs tabs={[{ key: 'sync', label: extSync.sync.tab }, ...(['systems', 'alm', 'supplier', 'otel', 'calls'] as const).map((k) => ({ key: k, label: G.tabs[k] }))]}>
        {(tab) => (tab === 'sync' ? <ExtSyncTab /> : tab === 'alm' ? <AlmTab /> : tab === 'supplier' ? <SupplierTab /> : tab === 'otel' ? <OtelTab /> : tab === 'calls' ? <CallsTab /> : <SystemsTab />)}
      </Tabs>
    </div>
  );
}

function SystemsTab() {
  const q = useApi<{ items: SystemRow[] }>('integrationSystems');
  const rows = q.data?.items ?? [];
  const C = G.col;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable
        caption={G.tabs.systems}
        rows={rows}
        rowKey={(r) => r.ifId}
        columns={[
          { key: 'if', header: C.if, cell: (r) => <span className="ds-mono ds-nowrap">{r.ifId}</span> },
          { key: 'n', header: C.name, cell: (r) => r.name },
          { key: 'm', header: C.mode, cell: (r) => <VerdictBadge value={r.mode === 'off' ? 'FAIL' : r.mode === 'live' ? 'PASS' : 'CONDITIONAL'} />, sort: (r) => r.mode },
          { key: 'm2', header: '', srHeader: C.mode, cell: (r) => <span className="ds-nowrap">{G.modes[r.mode] ?? r.mode}</span> },
          { key: 'a', header: C.adapter, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.adapter}</span> },
          { key: 'c', header: C.components, cell: (r) => <span className="ds-mono ds-nowrap">{r.components.join(' · ')}</span> },
          { key: 'n2', header: C.calls, cell: (r) => <span className="ds-mono">{r.calls}</span>, align: 'right', sort: (r) => r.calls },
          { key: 'l', header: C.last, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{r.lastAt?.slice(0, 19).replace('T', ' ') ?? '—'}</span> },
        ]}
      />
    </AsyncView>
  );
}

function AlmTab() {
  const [featureId, setF] = useState('FEAT-00022');
  const [version, setV] = useState('1.0.0');
  const q = useApi<{ items: { reqId: string; title: string; status: string; tracedGate: string; baseline: string | null }[] }>('almRequirements', { query: { featureId, version } });
  const rows = q.data?.items ?? [];
  const C = G.reqCol;
  return (
    <>
      <Toolbar label={G.tabs.alm}>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{G.feature}</span>
          <input className="ds-input ds-input--mono" value={featureId} onChange={(e) => setF(e.target.value.trim().toUpperCase())} disabled={STATIC_MODE} style={{ width: 120 }} />
        </label>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{G.version}</span>
          <input className="ds-input ds-input--mono" value={version} onChange={(e) => setV(e.target.value.trim())} disabled={STATIC_MODE} style={{ width: 80 }} />
        </label>
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable caption={G.tabs.alm} rows={rows} rowKey={(r) => r.reqId} columns={[
          { key: 'i', header: C.id, cell: (r) => <span className="ds-mono">{r.reqId}</span> },
          { key: 't', header: C.title, cell: (r) => r.title },
          { key: 's', header: C.status, cell: (r) => <span className="ds-mono">{r.status}</span> },
          { key: 'g', header: C.gate, cell: (r) => <span className="ds-mono">{r.tracedGate}</span> },
          { key: 'b', header: C.baseline, cell: (r) => <span className="ds-mono">{r.baseline ?? '—'}</span> },
        ]} />
      </AsyncView>
    </>
  );
}

function SupplierTab() {
  const q = useApi<{ items: { swId: string; version: string; supplier: string; artifactId: string; checksum: string; ecuPno: string }[] }>('supplierDeliveries');
  const rows = q.data?.items ?? [];
  const C = G.supCol;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable caption={G.tabs.supplier} rows={rows} rowKey={(r) => `${r.swId}@${r.version}`} maxHeight="62vh" columns={[
        { key: 's', header: C.sw, cell: (r) => <span className="ds-mono ds-nowrap">{r.swId}</span>, sort: (r) => r.swId },
        { key: 'v', header: C.version, cell: (r) => <span className="ds-mono">{r.version}</span> },
        { key: 'p', header: C.supplier, cell: (r) => r.supplier, sort: (r) => r.supplier },
        { key: 'a', header: C.artifact, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.artifactId}</span> },
        { key: 'c', header: C.checksum, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{String(r.checksum ?? '—').slice(0, 18)}</span> },
        { key: 'e', header: C.ecu, cell: (r) => <span className="ds-mono ds-nowrap">{r.ecuPno}</span> },
      ]} />
    </AsyncView>
  );
}

function OtelTab() {
  const q = useApi<{ items: { traceId: string; spanId: string; name: string; startTime: string; attributes: Record<string, unknown> }[] }>('otelSpans', { query: { limit: 100 } });
  const rows = q.data?.items ?? [];
  const C = G.spanCol;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: G.noSpans }} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable caption={G.tabs.otel} rows={rows} rowKey={(r) => r.spanId} maxHeight="62vh" columns={[
        { key: 'n', header: C.name, cell: (r) => <span className="ds-mono ds-nowrap">{r.name}</span> },
        { key: 'a', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{r.startTime.slice(11, 23)}</span> },
        { key: 't', header: C.trace, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.traceId.slice(0, 12)}</span> },
        { key: 'x', header: C.attrs, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{Object.entries(r.attributes).map(([k, v]) => `${k}=${v}`).join(' · ')}</span> },
      ]} />
    </AsyncView>
  );
}

function CallsTab() {
  const q = useApi<{ items: { ifId: string; key: string; at: string }[] }>('integrationCalls');
  const rows = q.data?.items ?? [];
  const C = G.callCol;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable caption={G.tabs.calls} rows={rows} rowKey={(r) => `${r.ifId}:${r.key}`} maxHeight="62vh" columns={[
        { key: 'i', header: C.if, cell: (r) => <span className="ds-mono">{r.ifId}</span>, sort: (r) => r.ifId },
        { key: 'k', header: C.key, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.key}</span> },
        { key: 'a', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{r.at.slice(0, 19).replace('T', ' ')}</span>, sort: (r) => r.at },
      ]} />
    </AsyncView>
  );
}

// ───────── 데이터 동기화 ─────────

interface TargetRow {
  targetId: string;
  ifId: string;
  name: string;
  system: string;
  market: string;
  direction: string;
  localProcessing: boolean;
  gate: { allowed: boolean; reason: string | null };
  last: { runId: string; status: string; at: string; diffs: number } | null;
}
interface RunRow {
  runId: string;
  targetId: string;
  status: string;
  at: string;
  by: string;
  records: { platform: number; external: number };
  diffs: { key: string; field: string; platform: string | null; external: string | null; kind: string }[];
  reason: string | null;
}
const RUN_BADGE: Record<string, string> = { SUCCEEDED: 'PASS', HELD: 'CONDITIONAL', FAILED: 'FAIL' };

export function DataSyncScreen() {
  const q = useApi<{ items: TargetRow[] }>('syncTargets');
  const perm = usePermission(['OPERATOR', 'SYSTEM', 'VARIANT_OWNER']);
  const run = useApiMutation<RunRow>('runSync', ['syncTargets', 'syncRuns', 'integrationSystems', 'events', 'audit']);
  const [open, setOpen] = useState<string | null>(null);
  const rows = q.data?.items ?? [];
  const C = S.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D05-02 · IF-02 · IF-03 · IF-12 · FFG-TEL-005"
        title={S.title}
        lead={S.lead}
        message={(() => {
          // 게이트 보류(표의 '보류')도 문제 대상이다 — 최근 실행만 보면 보류 행이 있는데 헤드라인이 초록이었다
          const bad = rows.filter((r) => !r.gate.allowed || (r.last && r.last.status !== 'SUCCEEDED')).length;
          const never = rows.filter((r) => !r.last).length;
          if (!q.data) return { tone: 'neutral', value: '—', text: S.key.bad };
          if (rows.length === 0) return { tone: 'neutral', value: 0, text: S.key.none };
          if (bad) return { tone: 'warn', value: bad, text: S.key.bad };
          return never ? { tone: 'neutral', value: never, text: S.key.never(never) } : { tone: 'ok', text: S.key.clean };
        })()}
      />
      <ErrorNote error={run.error} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={S.title}
          rows={rows}
          rowKey={(r) => r.targetId}
          onOpen={(r) => setOpen(r.targetId)}
          columns={[
            { key: 't', header: C.target, cell: (r) => <span><span className="ds-mono ds-nowrap">{r.targetId}</span><br />{r.name}</span> },
            { key: 'i', header: C.if, cell: (r) => <span className="ds-mono">{r.ifId}</span> },
            { key: 's', header: C.system, cell: (r) => <span className="ds-nowrap">{r.system}</span> },
            { key: 'm', header: C.market, cell: (r) => <span className="ds-nowrap"><span className="ds-tag">{r.market}</span>{r.localProcessing ? ` ${S.local}` : ''}</span> },
            { key: 'd', header: C.direction, cell: (r) => S.directions[r.direction] },
            { key: 'g', header: C.gate, cell: (r) => <span title={r.gate.reason ?? undefined} className="ds-nowrap"><VerdictBadge value={r.gate.allowed ? 'PASS' : 'CONDITIONAL'} /> {r.gate.allowed ? S.allowed : S.held}</span> },
            { key: 'l', header: C.last, cell: (r) => (r.last ? <span className="ds-nowrap">{`${S.status[r.last.status]} · ${S.diffs} ${r.last.diffs}`}</span> : S.never) },
            {
              key: 'a',
              header: '',
              cell: (r) => (
                <Button disabled={!perm.ok || run.isPending || STATIC_MODE} title={perm.hint} onClick={(e) => (e.stopPropagation(), run.mutate({ body: { targetId: r.targetId } }, { onSuccess: () => setOpen(r.targetId) }))}>
                  {S.run}
                </Button>
              ),
            },
          ]}
        />
      </AsyncView>
      <SyncDrawer targetId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function SyncDrawer({ targetId, onClose }: { targetId: string | null; onClose: () => void }) {
  const q = useApi<{ items: RunRow[] }>('syncRuns', { query: { targetId: targetId ?? '' } }, { enabled: !!targetId });
  const runs = q.data?.items ?? [];
  const last = runs[0];
  const C = S.diffCol;
  return (
    <Drawer open={!!targetId} title={`${targetId ?? ''} · ${S.runs}`} onClose={onClose}>
      <ul>
        {runs.map((r) => (
          <li key={r.runId} className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${r.runId} · ${S.status[r.status]} · ${r.at.slice(0, 19).replace('T', ' ')} · ${S.records(r.records.platform, r.records.external)}${r.reason ? ` · ${r.reason}` : ''}`}</li>
        ))}
      </ul>
      {last && (
        <Panel title={S.diffs} actions={<VerdictBadge value={RUN_BADGE[last.status]} />}>
          {last.diffs.length ? (
            <DataTable caption={S.diffs} rows={last.diffs} rowKey={(d) => `${d.key}:${d.field}`} columns={[
              { key: 'k', header: C.key, cell: (d) => <span className="ds-mono">{d.key}</span> },
              { key: 'f', header: C.field, cell: (d) => <span className="ds-mono">{d.field}</span> },
              { key: 'p', header: C.platform, cell: (d) => <span className="ds-mono">{d.platform ?? '—'}</span> },
              { key: 'e', header: C.external, cell: (d) => <span className="ds-mono">{d.external ?? '—'}</span> },
              { key: 'n', header: C.kind, cell: (d) => S.diffKind[d.kind] },
            ]} />
          ) : (
            <p className="ds-field__hint">{last.reason ?? S.noDiff}</p>
          )}
        </Panel>
      )}
    </Drawer>
  );
}

// ───────── Legacy 연계 · Legacy-SDV ─────────

export function LegacyScreen() {
  const maps = useApi<{ items: { legacyCode: string; system: string; description: string; featureId: string; featureName: string | null; note: string | null }[] }>('legacyMappings');
  const orders = useApi<{ items: { orderId: string; plant: string; market: string; vin: string; resolved: { legacyCode: string; featureId: string }[]; unresolved: string[] }[] }>('legacyOrders');
  const perm = usePermission(['OPERATOR', 'SYSTEM']);
  const imp = useApiMutation<{ plant: string; unresolved: string[] }>('importPlantOrders', ['legacyOrders', 'integrationSystems', 'events', 'audit']);
  const C = L.col;
  const orderRows = orders.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D05-03 · D05-07 · IF-12"
        title={L.title}
        lead={L.lead}
        message={(() => {
          const bad = orderRows.filter((o) => o.unresolved.length).length;
          return !orders.data ? { tone: 'neutral', value: '—', text: L.key.bad } : bad ? { tone: 'warn', value: bad, text: L.key.bad } : { tone: 'ok', text: L.key.clean };
        })()}
      />
      <Panel title={L.mappings}>
        <AsyncView state={asyncState(maps)} error={maps.error?.message} onRetry={() => maps.refetch()}>
          <DataTable caption={L.mappings} rows={maps.data?.items ?? []} rowKey={(r) => r.legacyCode} columns={[
            { key: 'c', header: C.code, cell: (r) => <span className="ds-mono ds-nowrap">{r.legacyCode}</span> },
            { key: 's', header: C.system, cell: (r) => <span className="ds-mono ds-nowrap">{r.system}</span> },
            { key: 'd', header: C.desc, cell: (r) => r.description },
            { key: 'f', header: C.feature, cell: (r) => <span className="ds-nowrap"><span className="ds-mono">{r.featureId}</span> {r.featureName ?? ''}</span> },
            { key: 'n', header: C.note, cell: (r) => r.note ?? '—' },
          ]} />
        </AsyncView>
      </Panel>
      <Panel
        title={L.orders}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
            {(['TMA', 'HMA', 'HMGC'] as const).map((p) => (
              <Button key={p} disabled={!perm.ok || imp.isPending || STATIC_MODE} title={perm.hint} onClick={() => imp.mutate({ body: { plant: p } })}>
                {L.import(p)}
              </Button>
            ))}
          </span>
        }
      >
        <ErrorNote error={imp.error} />
        {imp.data && imp.data.unresolved.length > 0 && <p className="ds-stale" role="status">{`${L.unresolved}: ${imp.data.unresolved.join(', ')}`}</p>}
        <AsyncView state={asyncState(orders, orderRows.length === 0)} empty={{ title: L.noOrders }} error={orders.error?.message} onRetry={() => orders.refetch()}>
          <DataTable caption={L.orders} rows={orderRows} rowKey={(r) => r.orderId} columns={[
            { key: 'o', header: C.order, cell: (r) => <span className="ds-mono ds-nowrap">{r.orderId}</span> },
            { key: 'p', header: C.plant, cell: (r) => <span className="ds-nowrap">{`${r.plant} · ${r.market}`}</span> },
            { key: 'v', header: C.vin, cell: (r) => <span className="ds-mono ds-nowrap">{r.vin}</span> },
            { key: 'r', header: C.resolved, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.resolved.map((x) => `${x.legacyCode}→${x.featureId}`).join(' · ')}</span> },
            { key: 'u', header: C.unresolvedCol, cell: (r) => <span className="ds-mono">{r.unresolved.join(', ') || '—'}</span> },
          ]} />
        </AsyncView>
      </Panel>
      <LegacySdvPanel />
    </div>
  );
}

function LegacySdvPanel() {
  const v = useApi<{ items: { vin: string; vehicleModel: string; modelYear: string; market: string; codingUnit: string }[] }>('legacyVehicles');
  const perm = usePermission(['OPERATOR', 'VARIANT_OWNER']);
  const tr = useApiMutation<{ supported: boolean; reason: string | null; fClass: string; commands: { unit: string; did: string; value: string; note: string }[] }>('translateLegacy', ['audit']);
  const vs = v.data?.items ?? [];
  const [vin, setVin] = useState('');
  const [featureId, setF] = useState('FEAT-00024');
  const [enable, setEnable] = useState(true);
  const pick = vin || vs[0]?.vin || '';
  const C = L.cmdCol;
  return (
    <Panel title={L.sdv} id="legacy-sdv">
      <div className="ds-toolbar">
        <Select label={L.vehicle} value={pick} onChange={(e) => setVin(e.target.value)}>
          {vs.map((x) => (
            <option key={x.vin} value={x.vin}>{`${x.vin} · ${x.vehicleModel} ${x.modelYear} · ${x.market} · ${x.codingUnit}`}</option>
          ))}
        </Select>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{L.feature}</span>
          <input className="ds-input ds-input--mono" value={featureId} onChange={(e) => setF(e.target.value.trim().toUpperCase())} style={{ width: 120 }} />
        </label>
        <Select label={L.enable} value={enable ? '1' : '0'} onChange={(e) => setEnable(e.target.value === '1')}>
          <option value="1">{L.enable}</option>
          <option value="0">{L.disable}</option>
        </Select>
        <Button variant="primary" disabled={!perm.ok || !pick || tr.isPending || STATIC_MODE} title={perm.hint} onClick={() => tr.mutate({ body: { vin: pick, featureId, enable } })}>
          {L.plan}
        </Button>
      </div>
      <ErrorNote error={tr.error} />
      {tr.data &&
        (tr.data.supported ? (
          <DataTable caption={L.supported} rows={tr.data.commands} rowKey={(c) => c.did} columns={[
            { key: 'u', header: C.unit, cell: (c) => <span className="ds-mono">{c.unit}</span> },
            { key: 'd', header: C.did, cell: (c) => <span className="ds-mono">{c.did}</span> },
            { key: 'v', header: C.value, cell: (c) => <span className="ds-mono">{c.value}</span> },
            { key: 'n', header: C.note, cell: (c) => c.note },
          ]} />
        ) : (
          <p className="ds-stale" role="status">{`${L.refused} — ${tr.data.reason}`}</p>
        ))}
    </Panel>
  );
}
