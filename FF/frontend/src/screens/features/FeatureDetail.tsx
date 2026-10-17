// /features/:id/:ver — Feature Version 상세 (v2). Lifecycle 전이·Gate 판정·의존관계·구현 추적·Baseline·감사.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GATES, type GateId, type Lifecycle } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import {
  AsyncView,
  Button,
  DataTable,
  Drawer,
  ErrorNote,
  Field,
  GateBadge,
  GateRail,
  IdChip,
  KeyValue,
  LifecycleBadge,
  LifecycleStepper,
  PageHeader,
  Panel,
  Select,
  Tabs,
  VerdictBadge,
  Icon,
} from '../../design';
import { scopeOf, usePermission, when } from '../shared';
import { SafetyBadges, SafetyTab } from './SafetyTab';
import { FeatureVersionActions } from './VersionEdit';
import type { AuditEntry, ChecklistItem, FeatureDetail as Detail, GateView } from '../types';

const T = ko.detail;
const ATTR_ORDER = ['featureId', 'name', 'description', 'requirementIds', 'country', 'vehicleModel', 'trim', 'version', 'baselineId', 'lifecycle', 'ownerId', 'tags', 'asil', 'upgVc', 'functions', 'swIds', 'swVersions', 'ecuPnos', 'controlPoints', 'dependencyIds'] as const;
const INVALIDATE = ['featureDetail', 'listFeatures', 'gates', 'audit', 'baselineRequests', 'baselineChecklist', 'baselines'];

export default function FeatureDetail() {
  const { id = '', ver = '' } = useParams();
  const nav = useNavigate();
  const q = useApi<Detail>('featureDetail', { params: { id, ver } });
  const d = q.data;
  const [transitionTo, setTransitionTo] = useState<Lifecycle | null>(null);

  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <PageHeader
              tour="feature-header"
              title={d.feature.name}
              message={{
                tone: d.feature.lifecycle === 'RELEASED' ? 'ok' : d.feature.lifecycle === 'DEPRECATED' || d.feature.lifecycle === 'RETIRED' ? 'neutral' : 'accent',
                value: d.feature.lifecycle,
                text: T.key.gatePass(ko.lifecycle[d.feature.lifecycle as keyof typeof ko.lifecycle] ?? d.feature.lifecycle, Object.values(d.gates).filter((g) => g.status === 'PASS').length, GATES.length),
              }}
              meta={
                <>
                  <IdChip id={d.feature.featureId} version={d.feature.version} />
                  <span className="ds-tag">{scopeOf(d.feature)}</span>
                  <span className="ds-tag">ASIL {d.feature.asil}</span>
                  <SafetyBadges id={id} ver={ver} />
                  <span className="ds-tag">{d.feature.ownerId}</span>
                  {d.feature.baselineId && <IdChip id={d.feature.baselineId} copy={false} />}
                </>
              }
              actions={
                <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <FeatureVersionActions key={`${id}@${ver}`} f={d.feature} latest={d.versions[d.versions.length - 1]?.version === ver} />
                  <Select label={T.versions} value={ver} onChange={(e) => nav(`/features/${id}/${e.target.value}`)}>
                    {d.versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version} · {v.lifecycle}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />

            <Panel id="lc">
              <LifecycleStepper current={d.feature.lifecycle} transitions={d.transitions} />
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                {d.transitions
                  .filter((t) => !t.auto)
                  .map((t) => (
                    <Button key={t.to} variant={t.to === 'DEPRECATED' || t.to === 'RETIRED' ? 'default' : 'primary'} onClick={() => setTransitionTo(t.to)}>
                      {T.transition(t.to)}
                    </Button>
                  ))}
                {d.transitions.some((t) => t.auto) && <span className="ds-field__hint">{T.autoNote}</span>}
              </div>
            </Panel>

            <Tabs
              tabs={[
                { key: 'overview', label: T.tabs.overview },
                { key: 'safety', label: T.tabs.safety },
                { key: 'gates', label: T.tabs.gates, count: Object.keys(d.gates).length },
                { key: 'deps', label: T.tabs.deps, count: d.dependencies.outgoing.length + d.dependencies.incoming.length },
                { key: 'trace', label: T.tabs.trace, count: d.trace.length },
                { key: 'baseline', label: T.tabs.baseline },
                { key: 'audit', label: T.tabs.audit },
              ]}
            >
              {(tab) =>
                tab === 'overview' ? (
                  <Overview d={d} />
                ) : tab === 'safety' ? (
                  <SafetyTab id={id} ver={ver} />
                ) : tab === 'gates' ? (
                  <Gates id={id} ver={ver} />
                ) : tab === 'deps' ? (
                  <Deps d={d} />
                ) : tab === 'trace' ? (
                  <Trace d={d} />
                ) : tab === 'baseline' ? (
                  <BaselineTab d={d} />
                ) : (
                  <AuditTab target={`${id}@${ver}`} />
                )
              }
            </Tabs>

            <TransitionDrawer d={d} to={transitionTo} onClose={() => setTransitionTo(null)} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function Overview({ d }: { d: Detail }) {
  const f = d.feature as any;
  const missing = (d.feature._missing ?? {}) as Record<string, string>;
  const show = (k: string) => {
    const v = f[k];
    if (k === 'lifecycle') return <LifecycleBadge value={v} />;
    if (k === 'functions') return (v as { functionId: string; label: string }[]).map((x) => <span key={x.functionId} className="ds-tag"><span className="ds-mono">{x.functionId}</span> {x.label}</span>);
    if (Array.isArray(v)) return v.length ? v.map((x: string, i: number) => <span key={i} className={/^[A-Z0-9-.@]+$/.test(x) ? 'ds-mono' : undefined}>{x}{i < v.length - 1 ? ',' : ''}</span>) : null;
    if (v === null || v === '') return null;
    return /^(FEAT|BL)-|^\d+\.\d+\.\d+$/.test(String(v)) ? <span className="ds-mono">{v}</span> : String(v);
  };
  return (
    <Panel id="attrs">
      <KeyValue rows={ATTR_ORDER.map((k) => ({ k: T.attrs[k], v: show(k) ?? <span style={{ color: 'var(--faint)' }}>—</span>, note: missing[k] }))} />
    </Panel>
  );
}

function Gates({ id, ver }: { id: string; ver: string }) {
  const q = useApi<GateView>('gates', { params: { id, ver } });
  const [selected, setSelected] = useState<GateId>('G1');
  const perm = usePermission(['GATE_JUDGE', 'SAFETY_OFFICER']);
  const judge = useApiMutation('judgeGate', INVALIDATE);
  const [form, setForm] = useState({ inputResult: 'PASS', rationale: '', evidenceRef: '' });
  const g = q.data?.gates.find((x) => x.gate === selected);
  const statuses = Object.fromEntries((q.data?.gates ?? []).map((x) => [x.gate, x.status === '미판정' ? null : x.status]));
  return (
    <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {!!q.data?.rehara?.length && (
          <section aria-label={T.rehara} data-testid="rehara">
            {q.data.rehara.some((x) => x.status === 'OPEN') && <p className="ds-field__hint" style={{ color: 'var(--danger)' }}>{T.reharaOpen(q.data.rehara.filter((x) => x.status === 'OPEN').length)}</p>}
            <ul className="ds-check">
              {q.data.rehara.map((x) => (
                <li key={x.requestId} data-state={x.status === 'OPEN' ? 'FAIL' : 'PASS'}>
                  <Icon name={x.status === 'OPEN' ? 'alert' : 'check'} size={16} />
                  <span>
                    <span className="ds-mono">{x.requestId}</span> {T.reharaCondition[x.condition] ?? x.condition}
                    <span className="ds-check__detail">{`${x.detail}${x.resolvedBy ? ` · ${T.reharaResolved(x.resolvedBy)}` : ''}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <GateRail statuses={statuses} onSelect={setSelected} tours={{ G5: 'gate-g5' }} />
        {g && (
          <div className="ds-split">
            <Panel title={`${g.gate} ${g.name}`} eyebrow={`${g.stage} · ${g.judgeRole}`} id="gate-hist" actions={<GateBadge status={g.status === '미판정' ? null : g.status} />}>
              {g.decision && (
                <p className="ds-field__hint" data-testid="gate-decision" style={{ color: g.decision.state === 'MISSING' || g.decision.state === 'INVALID' ? 'var(--danger)' : undefined }}>
                  {`${T.decision}: ${T.decisionState[g.decision.state]} · ${T.decisionNote(g.decision.kid, g.decision.approver ? (g.decision.approver.id ?? g.decision.approver.role) : null)}`}
                  {g.decision.reason ? ` — ${g.decision.reason}` : ''}
                </p>
              )}
              <h3 className="ds-eyebrow" style={{ margin: '0 0 var(--sp-2)' }}>{T.history}</h3>
              <DataTable
                caption={T.history}
                rows={[...g.history].reverse()}
                rowKey={(r) => r.gateRecordId}
                columns={[
                  { key: 'id', header: 'Gate Record', cell: (r) => <span className="ds-mono">{r.gateRecordId}</span> },
                  { key: 'st', header: ko.audit.col.result, cell: (r) => <GateBadge status={r.status} /> },
                  { key: 'at', header: ko.audit.col.at, cell: (r) => <span className="ds-mono">{r.judgedAt.slice(0, 16).replace('T', ' ')}</span> },
                  { key: 'ev', header: T.evidence, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.evidenceRef ?? '—'}</span> },
                  {
                    key: 'sig',
                    header: T.decision,
                    cell: (r) => (
                      <span data-testid={`decision-${r.gateRecordId}`} style={{ fontSize: 'var(--fs-xs)', color: r.decision === 'MISSING' || r.decision === 'INVALID' ? 'var(--danger)' : undefined }}>
                        {r.decision ? T.decisionState[r.decision] : '—'}
                      </span>
                    ),
                  },
                  { key: 'why', header: ko.page.reason, cell: (r) => r.rationale },
                ]}
              />
            </Panel>
            <Panel title={T.judge} id="judge">
              <form
                style={{ display: 'grid', gap: 'var(--sp-3)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  judge.mutate(
                    { params: { id, ver }, body: { gate: selected, inputResult: form.inputResult, rationale: form.rationale, evidenceRef: form.evidenceRef || null } },
                    { onSuccess: () => setForm({ inputResult: 'PASS', rationale: '', evidenceRef: '' }) },
                  );
                }}
              >
                <Field label={T.judgeResult}>
                  <select className="ds-select" value={form.inputResult} onChange={(e) => setForm({ ...form, inputResult: e.target.value })}>
                    <option value="PASS">PASS</option>
                    <option value="CONDITIONAL">CONDITIONAL</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                </Field>
                <Field label={T.evidence} hint={T.evidenceHint}>
                  <input className="ds-input ds-input--mono" value={form.evidenceRef} onChange={(e) => setForm({ ...form, evidenceRef: e.target.value })} />
                </Field>
                <Field label={ko.page.reason}>
                  <textarea className="ds-input" placeholder={ko.page.reasonPlaceholder} value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} />
                </Field>
                <ErrorNote error={judge.error} />
                {judge.isSuccess && <div className="ds-ok" role="status">{ko.page.saved}</div>}
                <Button type="submit" variant="primary" disabled={!perm.ok || judge.isPending} title={perm.hint}>
                  {selected} · {T.judge}
                </Button>
                {perm.hint && <span className="ds-field__hint">{perm.hint}</span>}
              </form>
            </Panel>
          </div>
        )}
      </div>
    </AsyncView>
  );
}

function Deps({ d }: { d: Detail }) {
  const table = (rows: Detail['dependencies']['outgoing'], caption: string) =>
    rows.length ? (
      <DataTable
        caption={caption}
        rows={rows}
        rowKey={(r) => r.dependencyId}
        columns={[
          { key: 'id', header: 'DEP', cell: (r) => <span className="ds-mono">{r.dependencyId}</span> },
          { key: 'type', header: 'Type', cell: (r) => <span className="ds-mono" style={{ fontWeight: 700 }}>{r.type}</span> },
          { key: 'src', header: 'Source', cell: (r) => <IdChip id={r.sourceFeatureId} version={r.sourceVersion} to={`/features/${r.sourceFeatureId}/${r.sourceVersion}`} copy={false} /> },
          { key: 'tgt', header: 'Target', cell: (r) => (r.targetVersion ? <IdChip id={r.targetFeatureId} version={r.targetVersion} to={`/features/${r.targetFeatureId}/${r.targetVersion}`} copy={false} /> : <span className="ds-mono">{r.targetFeatureId}</span>) },
          { key: 'v', header: ko.audit.col.result, cell: (r) => <VerdictBadge value={r.verdict} /> },
          { key: 'why', header: ko.page.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.rationale}</span> },
        ]}
      />
    ) : (
      <p className="ds-field__hint">{T.noDeps}</p>
    );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <Panel title={T.outgoing} id="dep-out">{table(d.dependencies.outgoing, T.outgoing)}</Panel>
      <Panel title={T.incoming} id="dep-in">{table(d.dependencies.incoming, T.incoming)}</Panel>
      <div>
        <Link to={`/analysis/impact?feature=${d.feature.featureId}&version=${d.feature.version}`}>{ko.impact.title} →</Link>
      </div>
    </div>
  );
}

function Trace({ d }: { d: Detail }) {
  const C = T.trace;
  return (
    <Panel id="trace">
      <DataTable
        caption={T.tabs.trace}
        rows={d.trace}
        rowKey={(r) => `${r.swId}@${r.swVersion}#${r.ecuPno}`}
        columns={[
          { key: 'f', header: C.function, cell: (r) => (r.function ? <><span className="ds-mono">{r.function.functionId}</span> {r.function.label}</> : '—') },
          { key: 'sw', header: C.sw, cell: (r) => <><span className="ds-mono">{r.swId}</span> <span style={{ color: 'var(--muted)' }}>{r.sw?.name}</span></> },
          { key: 'v', header: C.version, cell: (r) => <span className="ds-mono">{r.swVersion ?? '—'}</span> },
          { key: 'ecu', header: C.ecu, cell: (r) => <><span className="ds-mono">{r.ecuPno}</span> <span style={{ color: 'var(--muted)' }}>{r.ecu?.name}</span></> },
          { key: 'rt', header: C.runtime, cell: (r) => r.sw?.runtime ?? '—' },
          { key: 'st', header: C.status, cell: (r) => (r.sw ? <span className="ds-mono">{r.sw.lifecycle}</span> : <VerdictBadge value="FAIL" />) },
        ]}
      />
    </Panel>
  );
}

function BaselineTab({ d }: { d: Detail }) {
  const perm = usePermission(['FEATURE_AUTHOR']);
  const cl = useApi<{ items: ChecklistItem[] }>('baselineChecklist', { params: { id: d.feature.featureId, ver: d.feature.version } });
  const req = useApiMutation('requestBaseline', INVALIDATE);
  const [reason, setReason] = useState('');
  return (
    <div className="ds-split">
      <Panel title={T.tabs.baseline} id="bl">
        {d.baseline ? (
          <KeyValue
            rows={[
              { k: 'Baseline', v: <IdChip id={d.baseline.baselineId} /> },
              { k: T.baselineHash, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{d.baseline.contentHash}</span> },
              { k: ko.bom.decidedBy, v: d.baseline.approvedBy ?? '—', note: when(d.baseline.approvedAt) },
              { k: T.baselineProducts, v: d.products.length ? d.products.map((p) => <IdChip key={p.catalogId + p.version} id={p.catalogId} version={p.version} to={`/products/${p.catalogId}/${p.version}`} copy={false} />) : '—' },
            ]}
          />
        ) : (
          <p className="ds-field__hint">{T.baselineNone}</p>
        )}
        {d.pendingBaselineRequest && (
          <p style={{ marginBottom: 0 }}>
            <Link to={`/baselines?request=${d.pendingBaselineRequest.requestId}`}>{T.pending(d.pendingBaselineRequest.requestId)} →</Link>
          </p>
        )}
      </Panel>
      <Panel title={ko.bom.checklist} id="bl-check">
        <AsyncView state={asyncState(cl)} rows={4}>
          <Checklist items={cl.data?.items ?? []} />
        </AsyncView>
        {!d.baseline && !d.pendingBaselineRequest && (
          <form
            style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}
            onSubmit={(e) => {
              e.preventDefault();
              req.mutate({ body: { featureId: d.feature.featureId, version: d.feature.version, reason } });
            }}
          >
            <Field label={ko.page.reason}>
              <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
            </Field>
            <ErrorNote error={req.error} />
            <Button type="submit" variant="primary" disabled={!perm.ok || req.isPending} title={perm.hint}>
              {T.requestBaseline}
            </Button>
            {perm.hint && <span className="ds-field__hint">{perm.hint}</span>}
          </form>
        )}
      </Panel>
    </div>
  );
}

export function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="ds-check">
      {items.map((c) => (
        <li key={c.id} data-state={c.state}>
          <Icon name={c.state === 'PASS' ? 'check' : c.state === 'FAIL' ? 'close' : 'alert'} size={16} />
          <span>
            {c.label}
            <span className="ds-check__detail">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ target }: { target: string }) {
  const q = useApi<{ items: AuditEntry[] }>('audit', { query: { target, limit: 100 } });
  return (
    <AsyncView state={asyncState(q, (q.data?.items.length ?? 0) === 0)} error={q.error?.message}>
      <AuditTable rows={q.data?.items ?? []} />
    </AsyncView>
  );
}

export function AuditTable({ rows }: { rows: AuditEntry[] }) {
  const C = ko.audit.col;
  return (
    <DataTable
      caption={ko.audit.title}
      rows={rows}
      rowKey={(r) => String(r.id)}
      columns={[
        { key: 'at', header: C.at, cell: (r) => <span className="ds-mono">{when(r.at)}</span>, sort: (r) => r.at },
        { key: 'actor', header: C.actor, cell: (r) => <span className="ds-mono">{r.actorId}</span>, sort: (r) => r.actorId },
        { key: 'role', header: C.role, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.actorRole}</span> },
        { key: 'action', header: C.action, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.action}</span>, sort: (r) => r.action },
        { key: 'target', header: C.target, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.target}</span> },
        { key: 'result', header: C.result, cell: (r) => <VerdictBadge value={r.result === 'ALLOWED' ? 'PASS' : r.result === 'DENIED' ? 'CONDITIONAL' : 'FAIL'} />, sort: (r) => r.result },
        { key: 'reason', header: C.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason ?? ''}</span> },
      ]}
    />
  );
}

function TransitionDrawer({ d, to, onClose }: { d: Detail; to: Lifecycle | null; onClose: () => void }) {
  const opt = d.transitions.find((t) => t.to === to);
  const allowed = to === 'APPROVED' ? (['FEATURE_APPROVER'] as const) : (['RELEASE_MANAGER', 'GATE_JUDGE'] as const);
  const perm = usePermission(allowed);
  const m = useApiMutation('transition', INVALIDATE);
  const [reason, setReason] = useState('');
  // 역할·사유는 이 화면에서 채우는 조건이므로 그 외의 막힌 사유만 미리 보여 준다
  const hard = (opt?.blockers ?? []).filter((b) => !['ROLE', 'REASON_REQUIRED', 'SEPARATION_OF_DUTY'].includes(b.code));
  return (
    <Drawer open={!!to} title={to ? T.transition(to) : ''} onClose={onClose}>
      {opt && (
        <form
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ params: { id: d.feature.featureId, ver: d.feature.version }, body: { to, reason } }, { onSuccess: () => (setReason(''), onClose()) });
          }}
        >
          <p style={{ margin: 0 }}>
            <LifecycleBadge value={d.feature.lifecycle} /> → <LifecycleBadge value={opt.to} /> · {opt.ko}
          </p>
          {hard.length > 0 && <ErrorNote error={{ message: ko.stepper.blocked, details: { blockers: hard } }} />}
          {opt.to === 'RELEASED' && (
            <GateRail statuses={Object.fromEntries(GATES.map((g) => [g, d.gates[g]?.status ?? null]))} />
          )}
          <Field label={ko.page.reason}>
            <textarea className="ds-input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={m.error} />
          <Button type="submit" variant="primary" disabled={!perm.ok || hard.length > 0 || m.isPending} title={perm.hint}>
            {ko.page.submit}
          </Button>
          {perm.hint && <span className="ds-field__hint">{perm.hint}</span>}
          <p className="ds-field__hint" style={{ margin: 0 }}>
            {opt.roles.join(' · ')}
          </p>
        </form>
      )}
    </Drawer>
  );
}
