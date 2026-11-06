// /ops/feature-health — Feature 운영 점검(Closed loop 허브, TL-UI16) · /ops/feature-health/:findingId — 점검 결과 상세(TL-UI17).
// 운영 중인 Feature 버전 × 4축(동작·문제·개선·위험) 판정과 점검 결과. 판단 불가는 정상과 나눠 보인다(80-70 9.1).
// 상세: 근거 지표 스냅샷(신선도)·담당·기한·조치 연결·효과 기준·조치 전후 비교와 상태 흐름(감지 → 분석 중 → 조치 중 → 효과 확인 중 → 닫힘/다시 열림).
import { FreshnessChip } from '../../design/freshness';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FINDING_ACTIONS, FINDING_FLOW, HEALTH_AXES, ROLE_LABEL, findingOpen, judgeIndicator,
  type FeatureHealthResponse, type FeatureHealthRow, type FindingActionKind, type FindingStatus, type HealthFinding, type HealthState, type Role,
} from '@ff/contracts';
import { PLATFORM_ROLES } from '../../api/actor';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { lake as L } from '../../copy/lake';
import { AsyncView, Button, DataTable, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Segmented, Select, SummaryLine, Toolbar, type KeyMessageSpec } from '../../design';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';
import { FindingStatusBadge, HealthBadge, LakeOff } from './lake-ui';
import './lake.css';

const H = L.health;
const F = L.finding;
const OWNER_ROLES: Role[] = ['OPERATOR', 'OPS_LEAD', 'SAFETY_OFFICER', 'FEATURE_AUTHOR', 'RELEASE_MANAGER', 'SECURITY_OFFICER'];
const DAY = 86_400_000;

type AxisFilter = 'ALL' | (typeof HEALTH_AXES)[number];
type StateFilter = 'ALL' | HealthState;

const roleName = (r: string) => ROLE_LABEL[r as Role] ?? r;

/** 허브 핵심 메시지 — 조치 필요(열린 점검 결과) > 주의 > 판단 불가 > 모두 정상 */
function hubMessage(d: FeatureHealthResponse | undefined): KeyMessageSpec {
  if (!d) return { tone: 'neutral', value: '—', text: H.key.action(0) };
  const open = d.findings.filter((f) => findingOpen(f.status));
  const action = open.filter((f) => f.severity === 'ACTION').length;
  const overdue = open.filter((f) => f.overdue).length;
  if (action) return { tone: 'danger', value: action, text: H.key.action(overdue) };
  const watch = open.length;
  if (watch) return { tone: 'warn', value: watch, text: H.key.watch };
  const unknown = d.rows.filter((r) => r.worst === 'UNKNOWN').length;
  if (unknown) return { tone: 'warn', value: unknown, text: H.key.unknown };
  return { tone: 'ok', text: H.key.ok };
}

export function FeatureHealthScreen() {
  const q = useApi<FeatureHealthResponse>('featureHealth');
  const { role } = useAppShell();
  const mine = PLATFORM_ROLES[role] ?? [];
  const nav = useNavigate();
  const [axis, setAxis] = useState<AxisFilter>('ALL');
  const [state, setState] = useState<StateFilter>('ALL');
  const [owner, setOwner] = useState<'ALL' | 'MINE'>('ALL');
  const d = q.data;
  const findings = d?.findings ?? [];
  const open = findings.filter((f) => findingOpen(f.status));
  const axes = axis === 'ALL' ? HEALTH_AXES : [axis];
  const rank = (r: FeatureHealthRow) => ['ACTION', 'WATCH', 'UNKNOWN', 'OK'].indexOf(r.worst) * 1000 - r.openFindings;
  const rows = (d?.rows ?? []).slice().sort((a, b) => rank(a) - rank(b)).filter((r) => {
    const s = axes.map((a) => r.axes[a].state);
    if (state !== 'ALL' && !s.includes(state)) return false;
    if (owner === 'MINE' && !open.some((f) => f.featureId === r.featureId && f.version === r.version && mine.includes(f.ownerRole as Role) && (axis === 'ALL' || f.axis === axis))) return false;
    return true;
  });
  const shownFindings = findings.filter((f) => (axis === 'ALL' || f.axis === axis) && (owner === 'ALL' || mine.includes(f.ownerRole as Role)) && (state === 'ALL' || (state === 'ACTION' || state === 'WATCH' ? f.severity === state && findingOpen(f.status) : state === 'OK' ? !findingOpen(f.status) : false)));
  const count = (s: HealthState) => (d?.rows ?? []).filter((r) => r.worst === s).length;
  const fresh = d?.rows[0]?.freshness;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D04-03 · CLOSED LOOP"
        title={H.title}
        lead={H.lead}
        message={hubMessage(d)}
        meta={fresh ? <FreshnessChip f={fresh} /> : undefined}
      />
      <LakeOff connected={d?.connected}>
        {d && (
          <SummaryLine
            label={H.title}
            items={[
              { k: H.summary.versions, v: d.rows.length },
              { k: H.summary.watch, v: count('WATCH') },
              { k: H.summary.unknown, v: count('UNKNOWN') },
              { k: H.summary.open, v: open.length },
              { k: H.summary.closed, v: findings.length - open.length },
            ]}
          />
        )}
        <Toolbar label={H.filter.axis}>
          <Segmented label={H.filter.axis} value={axis} onChange={(v) => setAxis(v as AxisFilter)} options={[{ value: 'ALL', label: H.filter.all }, ...HEALTH_AXES.map((a) => ({ value: a, label: L.axis[a] }))]} />
          <Segmented label={H.filter.state} value={state} onChange={(v) => setState(v as StateFilter)} options={[{ value: 'ALL', label: H.filter.all }, ...(['ACTION', 'WATCH', 'UNKNOWN', 'OK'] as const).map((s) => ({ value: s, label: L.state[s], count: count(s) }))]} />
          <Segmented label={H.filter.owner} value={owner} onChange={(v) => setOwner(v as 'ALL' | 'MINE')} options={[{ value: 'ALL', label: H.filter.all }, { value: 'MINE', label: H.filter.mine }]} />
        </Toolbar>
        <Panel title={H.rows} id="health-rows" eyebrow={H.loop}>
          <AsyncView state={asyncState(q, rows.length === 0)} filtered={axis !== 'ALL' || state !== 'ALL' || owner !== 'ALL'} error={q.error} onRetry={() => q.refetch()}>
            <DataTable
              caption={H.rows}
              rows={rows}
              rowKey={(r) => `${r.featureId}@${r.version}`}
              onOpen={(r) => {
                const f = open.find((x) => x.featureId === r.featureId && x.version === r.version);
                nav(f ? `/ops/feature-health/${f.findingId}` : `/features/${r.featureId}/${r.version}?tab=ops`);
              }}
              columns={[
                { key: 'f', header: H.col.feature, cell: (r) => <span><strong>{r.name}</strong> <span className="ds-mono ds-nowrap">{r.featureId} {r.version}</span></span>, sort: (r) => r.featureId + r.version },
                { key: 'm', header: H.col.market, cell: (r) => <span className="ds-mono">{r.market}</span> },
                { key: 'v', header: H.col.vehicles, cell: (r) => <span className="ds-mono ds-nowrap">{L.vehicles(r.activeVehicles)}</span>, align: 'right', sort: (r) => r.activeVehicles ?? 0 },
                ...HEALTH_AXES.map((a) => ({
                  key: a,
                  header: L.axis[a],
                  cell: (r: FeatureHealthRow) => <HealthBadge state={r.axes[a].state} title={H.cell(L.axis[a], L.state[r.axes[a].state], r.axes[a].cause ? L.indicator[r.axes[a].cause!] : null)} />,
                  sort: (r: FeatureHealthRow) => ['ACTION', 'WATCH', 'UNKNOWN', 'OK'].indexOf(r.axes[a].state),
                })),
                { key: 'o', header: H.col.findings, cell: (r) => <span className="ds-mono">{r.openFindings}{r.overdue ? ` · ${H.overdue} ${r.overdue}` : ''}</span>, align: 'right', sort: (r) => r.openFindings },
                { key: 'fr', header: H.col.fresh, cell: (r) => <FreshnessChip f={r.freshness} compact /> },
              ]}
            />
          </AsyncView>
          <p className="ds-field__hint">{H.unknownNote}</p>
        </Panel>
        <Panel title={H.findings} id="health-findings">
          <FindingTable rows={shownFindings} />
        </Panel>
      </LakeOff>
    </div>
  );
}

/** 점검 결과 목록 — 허브·Feature 운영 지표 탭이 같이 쓴다 */
export function FindingTable({ rows, caption = H.findings }: { rows: HealthFinding[]; caption?: string }) {
  const nav = useNavigate();
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(f) => f.findingId}
      onOpen={(f) => nav(`/ops/feature-health/${f.findingId}`)}
      initialSort={{ key: 'st', dir: 'asc' }}
      columns={[
        { key: 'id', header: H.findingCol.id, cell: (f) => <Link className="ds-mono" to={`/ops/feature-health/${f.findingId}`}>{f.findingId}</Link>, sort: (f) => f.findingId },
        { key: 'f', header: H.findingCol.feature, cell: (f) => <span>{f.featureName} <span className="ds-mono ds-nowrap">{f.version}</span></span> },
        { key: 'a', header: H.findingCol.axis, cell: (f) => <HealthBadge state={findingOpen(f.status) ? f.severity : 'OK'} title={L.axisQ[f.axis]} /> },
        { key: 'ax', header: '', srHeader: H.findingCol.axis, cell: (f) => L.axis[f.axis] },
        { key: 'c', header: H.findingCol.cause, cell: (f) => L.indicator[f.cause] },
        { key: 'st', header: H.findingCol.status, cell: (f) => <FindingStatusBadge status={f.status} />, sort: (f) => (findingOpen(f.status) ? 0 : 1) * 10 + (f.overdue ? 0 : 1) },
        { key: 'o', header: H.findingCol.owner, cell: (f) => roleName(f.ownerRole) },
        { key: 'd', header: H.findingCol.due, cell: (f) => <span className="ds-mono ds-nowrap" data-overdue={f.overdue ? '' : undefined}>{when(f.dueAt)}{f.overdue ? ` · ${H.overdue}` : ''}</span>, sort: (f) => f.dueAt },
        { key: 'r', header: H.findingCol.repeat, cell: (f) => (f.repeats ? H.repeat(f.repeats) : '—'), align: 'right', sort: (f) => f.repeats },
      ]}
    />
  );
}

/** 상세 핵심 메시지 */
function findingMessage(f: HealthFinding, now: number): KeyMessageSpec {
  const status = L.findingStatus[f.status];
  if (f.status === 'CLOSED') return { tone: 'ok', text: F.key.closed, status: { label: status, tone: 'ok' } };
  if (f.status === 'VERIFYING' && f.effect?.met === true) return { tone: 'ok', text: F.key.met, status: { label: status, tone: 'ok' } };
  if (f.status === 'VERIFYING' && f.effect?.met === false) return { tone: 'warn', text: F.key.notMet, status: { label: status, tone: 'warn' } };
  const left = (Date.parse(f.dueAt) - now) / DAY;
  if (f.overdue) return { tone: 'danger', value: Math.max(1, Math.ceil(-left)), text: F.key.overdue(status), status: { label: L.state[f.severity], tone: f.severity === 'ACTION' ? 'danger' : 'warn' } };
  return { tone: f.severity === 'ACTION' ? 'danger' : 'warn', text: F.key.due(status, F.left(left)), status: { label: L.state[f.severity], tone: f.severity === 'ACTION' ? 'danger' : 'warn' } };
}

const FLOW: FindingStatus[] = ['DETECTED', 'ANALYZING', 'ACTING', 'VERIFYING', 'CLOSED'];

export function FindingScreen() {
  const { findingId = '' } = useParams();
  const q = useApi<HealthFinding>('featureHealthFinding', { params: { id: findingId } });
  const f = q.data;
  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {f && (
          <>
            <PageHeader
              codes="D04-03 · FINDING"
              title={F.heading(f.featureName, f.version, L.axis[f.axis])}
              lead={F.lead}
              message={findingMessage(f, Date.now())}
              meta={
                <>
                  <IdChip id={f.findingId} />
                  <IdChip id={f.featureId} version={f.version} to={`/features/${f.featureId}/${f.version}?tab=ops`} copy={false} />
                  {f.repeats > 0 && <span className="ds-tag">{H.repeat(f.repeats)}</span>}
                </>
              }
              actions={<Link className="ds-btn" to="/ops/feature-health">{F.toHub}</Link>}
            />
            <Panel title={F.flow} id="finding-flow" eyebrow={L.axisQ[f.axis]}>
              <ol className="lk-flow" aria-label={F.flow}>
                {(f.status === 'REOPENED' ? [...FLOW.slice(0, 4), 'REOPENED' as FindingStatus] : FLOW).map((s) => {
                  const reached = f.history.some((h) => h.to === s);
                  return (
                    <li key={s} data-current={s === f.status ? '' : undefined} data-reached={reached ? '' : undefined} aria-current={s === f.status ? 'step' : undefined}>
                      {L.findingStatus[s]}
                    </li>
                  );
                })}
              </ol>
            </Panel>
            <div className="ds-split">
              <Panel title={F.evidence} id="finding-evidence" actions={<FreshnessChip f={f.evidence.freshness} />}>
                <DataTable
                  caption={F.evidence}
                  rows={f.evidence.indicators}
                  rowKey={(i) => i.name}
                  columns={[
                    { key: 'n', header: F.col.indicator, cell: (i) => <span style={{ fontWeight: i.name === f.cause ? 700 : 400 }}>{L.indicator[i.name]}</span> },
                    { key: 'c', header: F.col.current, cell: (i) => <span className="ds-mono">{L.value(i.name, i.current)}</span>, align: 'right' },
                    { key: 'p', header: F.col.previous, cell: (i) => <span className="ds-mono">{L.value(i.name, i.previous)}</span>, align: 'right' },
                    { key: 's', header: F.col.sample, cell: (i) => <span className="ds-mono">{i.sampleVehicles?.toLocaleString('ko-KR') ?? '—'}</span>, align: 'right' },
                    { key: 'j', header: F.col.judge, cell: (i) => <HealthBadge state={judgeIndicator(i)} /> },
                  ]}
                />
              </Panel>
              <Panel title={F.owner} id="finding-owner">
                <KeyValue
                  rows={[
                    { k: F.ownerRole, v: roleName(f.ownerRole) },
                    { k: F.due, v: <span className="ds-mono">{when(f.dueAt)}</span>, note: f.overdue ? H.overdue : undefined },
                    { k: F.detected, v: <span className="ds-mono">{when(f.detectedAt)}</span> },
                    { k: F.repeats, v: f.repeats ? H.repeat(f.repeats) : '—' },
                  ]}
                />
              </Panel>
            </div>
            <div className="ds-split">
              <Panel title={F.actions} id="finding-actions">
                {f.actions.length ? (
                  <DataTable
                    caption={F.actions}
                    rows={f.actions}
                    rowKey={(a) => `${a.kind}-${a.ref}-${a.at}`}
                    columns={[
                      { key: 'k', header: F.col.kind, cell: (a) => L.actionKind[a.kind] },
                      { key: 'r', header: F.col.ref, cell: (a) => <span className="ds-mono">{a.ref}</span> },
                      { key: 't', header: F.col.title, cell: (a) => a.title },
                      { key: 'a', header: F.col.at, cell: (a) => <span className="ds-mono ds-nowrap">{when(a.at)}</span> },
                    ]}
                  />
                ) : (
                  <p className="ds-field__hint">{F.actionsNone}</p>
                )}
              </Panel>
              <Panel title={F.effect} id="finding-effect">
                {f.effect ? (
                  <KeyValue
                    rows={[
                      { k: F.effectCol.target, v: <span className="ds-mono">{L.value(f.effect.indicator, f.effect.target)}</span>, note: L.indicator[f.effect.indicator] },
                      { k: F.effectCol.before, v: <span className="ds-mono">{L.value(f.effect.indicator, f.effect.before)}</span> },
                      { k: F.effectCol.after, v: <span className="ds-mono">{L.value(f.effect.indicator, f.effect.after)}</span>, note: f.effect.ci ? `${F.effectCol.ci} ${L.value(f.effect.indicator, f.effect.ci[0])} ~ ${L.value(f.effect.indicator, f.effect.ci[1])}` : undefined },
                      { k: F.effectCol.samples, v: <span className="ds-mono">{f.effect.samples?.toLocaleString('ko-KR') ?? '—'}</span> },
                      { k: F.effectCol.met, v: <HealthBadge state={f.effect.met === true ? 'OK' : f.effect.met === false ? 'ACTION' : 'UNKNOWN'} title={f.effect.met === true ? F.met.yes : f.effect.met === false ? F.met.no : F.met.pending} />, note: f.effect.met === true ? F.met.yes : f.effect.met === false ? F.met.no : F.met.pending },
                    ]}
                  />
                ) : (
                  <p className="ds-field__hint">{F.effectNone}</p>
                )}
              </Panel>
            </div>
            <MovePanel f={f} />
            <Panel title={F.history} id="finding-history">
              <DataTable
                caption={F.history}
                rows={[...f.history].reverse()}
                rowKey={(h) => `${h.at}-${h.to}`}
                columns={[
                  { key: 'at', header: F.col.at, cell: (h) => <span className="ds-mono ds-nowrap">{when(h.at)}</span> },
                  { key: 'fr', header: F.col.from, cell: (h) => (h.from ? L.findingStatus[h.from] : '—') },
                  { key: 'to', header: F.col.to, cell: (h) => <FindingStatusBadge status={h.to} /> },
                  { key: 'by', header: F.col.by, cell: (h) => <span className="ds-mono">{h.by === 'SYSTEM' ? F.system : h.by}</span> },
                  { key: 'n', header: F.col.note, cell: (h) => h.note },
                ]}
              />
            </Panel>
          </>
        )}
      </AsyncView>
    </div>
  );
}

/** 다음 단계로 옮기기 — 갈 수 있는 상태만, 조치 연결은 함께 */
function MovePanel({ f }: { f: HealthFinding }) {
  const perm = usePermission(OWNER_ROLES);
  const move = useApiMutation<HealthFinding>('moveFinding', ['featureHealth', 'featureHealthFinding', 'featureOpsMetrics']);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<FindingActionKind | ''>('');
  const [ref, setRef] = useState('');
  const [title, setTitle] = useState('');
  const next = FINDING_FLOW[f.status];
  const action = kind && ref.trim() && title.trim() ? { kind, ref: ref.trim(), title: title.trim() } : undefined;
  const why = (to: FindingStatus) =>
    !next.length ? F.why.done : to === 'ACTING' && !f.actions.length && !action ? F.why.needAction : to === 'CLOSED' && f.effect?.met !== true ? F.why.needEffect : note.trim().length < 2 ? F.why.note : undefined;
  const options = useMemo(() => FINDING_ACTIONS.map((k) => ({ value: k, label: L.actionKind[k] })), []);
  if (!next.length) return null;
  return (
    <Panel title={F.move} id="finding-move">
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <Field label={F.note}>
          <textarea className="ds-input" name="finding-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={F.notePlaceholder} />
        </Field>
        <fieldset className="lk-action">
          <legend>{F.addAction}</legend>
          <Select label={F.actionKind} name="finding-action-kind" value={kind} onChange={(e) => setKind(e.target.value as FindingActionKind | '')}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Field label={F.actionRef}>
            <input className="ds-input ds-input--mono" name="finding-action-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Field label={F.actionTitle}>
            <input className="ds-input" name="finding-action-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </fieldset>
        <ErrorNote error={move.error} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {next.map((to) => {
            const reason = perm.ok ? why(to) : undefined;
            return (
              <Button
                key={to}
                data-ui={`finding-${to.toLowerCase()}`}
                variant={to === 'CLOSED' || to === 'ACTING' || to === 'VERIFYING' ? 'primary' : 'default'}
                disabled={!perm.ok || !!reason || move.isPending}
                title={perm.hint}
                reason={reason}
                onClick={() => move.mutate({ params: { id: f.findingId }, body: { to, note: note.trim(), ...(action ? { action } : {}) } }, { onSuccess: () => (setNote(''), setKind(''), setRef(''), setTitle('')) })}
              >
                {F.to[to]}
              </Button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
