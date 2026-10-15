// /ops/safety-kpi — 운행 중 감시 지표 (D04-03, 보고서 v1.1 13.4·13.5 · FFG-TEL-009). 출시 Feature Version마다 지표 6종·경보,
// Safety Case 경보 기준 기록(FSM), ADS 기능의 부속서 1 정기 보고. 값은 서버(contracts computeMetrics)가 계산한다.
import { useState } from 'react';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, Kpi, PageHeader, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const K = ko.safetyKpi;
type MetricId = keyof typeof K.metric;
type Op = 'ABOVE' | 'AT_LEAST' | 'RISE' | 'FACTOR';

interface MetricDef {
  id: MetricId;
  definition: string;
  type: keyof typeof K.type;
  unit: 'ms' | 'ratio' | 'count';
  alert: { op: Op; example: number; text: string };
}
interface MetricValue {
  id: MetricId;
  value: number | null;
  previous: number | null;
  threshold: number;
  alert: boolean;
}
interface Item {
  featureId: string;
  version: string;
  ads: boolean;
  plan: { source: keyof typeof K.source; thresholds: Record<MetricId, number>; recordedBy: string | null; recordedAt: string | null };
  metrics: MetricValue[];
}
interface Overview {
  definitions: MetricDef[];
  coverage: { missing: unknown[]; exampleOnly: unknown[] };
  items: Item[];
  alerts: number;
}
interface Annex1 {
  applicable: boolean;
  from: string;
  to: string;
  lines: { id: string; label: string; count: number | null; detail: Record<string, number>; note: string | null }[];
  missing: string[];
}

const HOUR = 3_600_000;
function fmtValue(unit: MetricDef['unit'], v: number | null) {
  if (v === null) return K.noValue;
  if (unit === 'ms') return v < HOUR ? `${(v / 1000).toFixed(1)}s` : `${(v / HOUR).toFixed(1)}${K.unit.hours}`;
  if (unit === 'ratio') return `${(v * 100).toFixed(1)}%`;
  return String(v);
}
/** 경보 기준 ↔ 입력 단위(지연 시간·비율 증가 %p·배수·건수) */
const toInput = (op: Op, t: number) => (op === 'ABOVE' ? t / HOUR : op === 'RISE' ? t * 100 : t);
const fromInput = (op: Op, x: number) => (op === 'ABOVE' ? Math.round(x * HOUR) : op === 'RISE' ? x / 100 : x);
const opUnit = (op: Op) => (op === 'ABOVE' ? K.unit.hours : op === 'RISE' ? K.unit.pp : op === 'FACTOR' ? K.unit.factor : K.unit.count);
function fmtThreshold(op: Op, t: number) {
  const x = Number(toInput(op, t).toFixed(2));
  return op === 'ABOVE' ? `> ${x}${K.unit.hours}` : op === 'RISE' ? `+${x}${K.unit.pp}` : op === 'FACTOR' ? `×${x}` : `≥ ${x}`;
}

function MetricText({ unit, v }: { unit: MetricDef['unit']; v: number | null }) {
  return v === null ? <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>{K.noValue}</span> : <span className="ds-mono">{fmtValue(unit, v)}</span>;
}

function MetricBadge({ m }: { m: MetricValue }) {
  return <VerdictBadge value={m.value === null ? '미판정' : m.alert ? 'FAIL' : 'PASS'} />;
}

function PlanForm({ item, defs }: { item: Item; defs: MetricDef[] }) {
  const perm = usePermission(['SAFETY_OFFICER']);
  const rec = useApiMutation('recordSafetyKpiPlan', ['safetyKpi', 'audit']);
  const current = (d: MetricDef) => String(Number(toInput(d.alert.op, item.plan.thresholds[d.id]).toFixed(2)));
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(defs.map((d) => [d.id, current(d)])));
  const thresholds = Object.fromEntries(
    defs.flatMap((d) => {
      const raw = f[d.id]?.trim();
      return raw && raw !== current(d) && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? [[d.id, fromInput(d.alert.op, Number(raw))]] : [];
    }),
  );
  return (
    <form
      style={{ display: 'grid', gap: 'var(--sp-2)' }}
      onSubmit={(e) => {
        e.preventDefault();
        rec.mutate({ params: { featureId: item.featureId, version: item.version }, body: { thresholds } });
      }}
    >
      <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600 }}>
        {K.plan.title}
      </h3>
      <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{item.plan.recordedBy && item.plan.recordedAt ? K.plan.recorded(item.plan.recordedBy, when(item.plan.recordedAt)) : K.plan.hint}</p>
      <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {defs.map((d) => (
          <Field key={d.id} label={`${K.metric[d.id]} (${opUnit(d.alert.op)})`}>
            <input className="ds-input ds-input--mono" inputMode="decimal" value={f[d.id] ?? ''} onChange={(e) => setF({ ...f, [d.id]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={!perm.ok || rec.isPending || !Object.keys(thresholds).length} title={perm.hint}>
          {K.plan.submit}
        </Button>
      </div>
      {rec.error && <ErrorNote error={rec.error} />}
    </form>
  );
}

function Annex1Section({ item }: { item: Item }) {
  const q = useApi<Annex1>('safetyKpiAnnex1', { params: { featureId: item.featureId, version: item.version } });
  const r = q.data;
  return (
    <section style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600 }}>
        {K.annex.title}
      </h3>
      <AsyncView state={asyncState(q, false)} error={q.error?.message} onRetry={() => q.refetch()}>
        {r && !r.applicable ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>{K.annex.notAds}</p>
        ) : r ? (
          <>
            <VerdictBadge value={r.missing.length ? 'FAIL' : 'PASS'} />
            <span style={{ fontSize: 'var(--fs-sm)' }}>{r.missing.length ? K.annex.missing(r.missing.length) : K.annex.complete}</span>
            <DataTable
              caption={K.annex.title}
              rows={r.lines}
              rowKey={(l) => l.id}
              columns={[
                { key: 'l', header: K.annex.item, cell: (l) => l.label },
                { key: 'c', header: K.annex.count, cell: (l) => <span className="ds-mono">{l.count ?? '—'}</span>, align: 'right' },
                {
                  key: 'd',
                  header: K.annex.detail,
                  cell: (l) => (
                    <span style={{ fontSize: 'var(--fs-xs)' }}>
                      <span className="ds-mono">{Object.entries(l.detail).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</span>
                      {l.note && <div style={{ color: 'var(--muted)' }}>{l.note}</div>}
                    </span>
                  ),
                },
              ]}
            />
          </>
        ) : null}
      </AsyncView>
    </section>
  );
}

function KpiDrawer({ item, defs, onClose }: { item: Item | null; defs: MetricDef[]; onClose: () => void }) {
  return (
    <Drawer open={!!item} title={item ? `${item.featureId} ${item.version}` : ''} onClose={onClose}>
      {item && (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <KeyValue
            rows={defs.map((d) => {
              const m = item.metrics.find((x) => x.id === d.id)!;
              return {
                k: K.metric[d.id],
                v: (
                  <span style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <MetricBadge m={m} />
                      <MetricText unit={d.unit} v={m.value} />
                      {m.previous !== null && <span className="ds-mono" style={{ color: 'var(--muted)' }}>{`${K.kv.previous} ${fmtValue(d.unit, m.previous)}`}</span>}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>{`${K.kv.threshold} ${fmtThreshold(d.alert.op, m.threshold)} (${K.source[item.plan.source]})`}</span>
                  </span>
                ),
                note: `${d.definition} · ${K.type[d.type]}`,
              };
            })}
          />
          <PlanForm key={`${item.featureId}@${item.version}@${item.plan.recordedAt ?? ''}`} item={item} defs={defs} />
          <Annex1Section item={item} />
        </div>
      )}
    </Drawer>
  );
}

export function SafetyKpiScreen() {
  const q = useApi<Overview>('safetyKpi');
  usePlatformEvents(['kill.', 'vehicle.status', 'vsoc.alert', 'safety.metric'], ['safetyKpi', 'safetyKpiAnnex1']);
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  const defs = d?.definitions ?? [];
  const items = d?.items ?? [];
  const selected = items.find((i) => `${i.featureId}@${i.version}` === open) ?? null;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D04-03 · IN-SERVICE MONITORING · FFG-TEL-009" title={K.title} lead={K.lead} />
      <div className="ds-kpis">
        <Kpi label={K.kpi.released} value={items.length} />
        <Kpi label={K.kpi.alerts} value={d?.alerts ?? 0} tone={d?.alerts ? 'danger' : 'ok'} />
        <Kpi label={K.kpi.ads} value={items.filter((i) => i.ads).length} />
        <Kpi label={K.kpi.recorded} value={`${items.length - (d?.coverage.exampleOnly.length ?? 0)}/${items.length}`} tone={d?.coverage.exampleOnly.length ? 'warn' : 'ok'} />
      </div>
      <AsyncView state={asyncState(q, items.length === 0)} empty={{ title: K.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={K.title}
          rows={items}
          rowKey={(i) => `${i.featureId}@${i.version}`}
          onOpen={(i) => setOpen(`${i.featureId}@${i.version}`)}
          columns={[
            { key: 'f', header: K.col.feature, cell: (i) => <span className="ds-mono ds-nowrap">{i.featureId}</span>, sort: (i) => i.featureId },
            { key: 'v', header: K.col.version, cell: (i) => <span className="ds-mono">{i.version}</span> },
            { key: 's', header: K.col.source, cell: (i) => <span className="ds-tag">{K.source[i.plan.source]}</span>, sort: (i) => i.plan.source },
            ...defs.map((m) => ({
              key: m.id,
              header: K.metric[m.id],
              cell: (i: Item) => {
                const v = i.metrics.find((x) => x.id === m.id)!;
                return (
                  <span className="ds-nowrap" style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                    {v.alert && <VerdictBadge value="FAIL" />}
                    <MetricText unit={m.unit} v={v.value} />
                  </span>
                );
              },
            })),
            { key: 'a', header: K.col.alerts, cell: (i) => <span className="ds-mono">{i.metrics.filter((m) => m.alert).length}</span>, sort: (i) => i.metrics.filter((m) => m.alert).length, align: 'right' as const },
          ]}
        />
      </AsyncView>
      <KpiDrawer item={selected} defs={defs} onClose={() => setOpen(null)} />
    </div>
  );
}
