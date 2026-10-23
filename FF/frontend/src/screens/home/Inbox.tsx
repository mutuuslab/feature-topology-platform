// v2 (P10-C4) — / 내 대시보드 · /admin/approval 검토함 · /feature/propose Feature 제안 · /master/define Feature 등록.
// 검토함은 승인할 일을 모아 "내 차례인가"를 보이고 실제 승인은 각 화면에서 한다. 차단·복원의 내 차례 판정은 서버와 같은 contracts approvalCheck
// (요청자·이미 승인한 사람·FSM 칸·복원은 차단 승인자 제외 — FFG-PLT-005·DEAC-008).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { approvalCheck, approvalPlan, LIFECYCLE, reportRolesOf, type Role } from '@ff/contracts';
import { actorFor, PLATFORM_ROLES } from '../../api/actor';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { ops5y } from '../../copy/ops5y';
import { procedures as PR } from '../../copy/procedures';
import { useProcedureSummary } from '../../data/procedureProgress';
import { formatCount, formatExact } from '../../design/format';
import { AsyncView, type AsyncState, Button, DataTable, ErrorNote, Field, LifecycleBadge, PageHeader, Panel, Segmented, Select, SummaryLine, VerdictBadge, type KeyMessageSpec } from '../../design';
import { useAppShell } from '../../store';
import { usePermission } from '../shared';
import { DashboardHero } from './DashboardHero';
import { ProcedureMap } from './ProcedureMap';

const I = ko.master.inbox;
const O = ops5y.home;
const t16 = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

interface Item {
  key: string;
  queue: keyof typeof I.queues;
  item: string;
  detail: string;
  since: string | null;
  who: string | null;
  mine: boolean;
  why: string | null;
  to: string;
}

interface KillRow {
  killId: string;
  featureId: string;
  featureVersion: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  reasonCategory?: string;
  fClass?: string;
  approvals?: { approverId: string; role: string }[];
  restoreRequest?: { status: string; requestedBy: string; requestedAt: string; approvals: { approverId: string; role: string }[] } | null;
}

/** 승인할 일 모으기 — 역할에 따라 내 차례 표시 */
export function useInbox() {
  const { role } = useAppShell();
  const mine = PLATFORM_ROLES[role] ?? [];
  const me = actorFor(role);
  const has = (r: Role) => mine.includes(r);
  const bl = useApi<{ items: { requestId: string; featureId: string; version: string; requestedBy: string; requestedAt: string }[] }>('baselineRequests', { query: { status: 'REQUESTED' } });
  const pol = useApi<{ items: { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string; createdBy: string; createdAt: string }[] }>('listPolicies', { query: { status: 'VALIDATED' } });
  const prod = useApi<{ items: { catalogId: string; version: string; name: string; lifecycle: string }[] }>('listProducts');
  const saf = useApi<{ items: { featureId: string; version: string; status: string; fClass: string }[] }>('safetyProfiles');
  const kills = useApi<{ items: KillRow[] }>('killRequests');
  // GitLab·JIRA·codeBeamer 동기화 충돌 — 사람이 플랫폼 값·외부 값 중 골라야 한다
  const sync = useApi<{ items: { conflictId: number; system: string; key: string; field: string; platformValue: string; externalValue: string; createdAt: string }[] }>('extConflicts', { query: { status: 'OPEN' } });
  const queries = [bl, pol, prod, saf, kills, sync];
  const reportRoles = reportRolesOf(mine);
  const killCheck = (k: KillRow, request: 'deactivate' | 'restore') => {
    const rr = k.restoreRequest;
    const plan = approvalPlan((k.fClass ?? 'F0') as never, request, (k.reasonCategory ?? 'SAFETY') as never);
    const s = request === 'deactivate' ? { requestedBy: k.requestedBy, approvals: (k.approvals ?? []) as never[], plan } : { requestedBy: rr!.requestedBy, approvals: rr!.approvals as never[], plan, excluded: (k.approvals ?? []).map((a) => a.approverId) };
    return approvalCheck(s, { id: me.id, roles: reportRoles });
  };
  const items: Item[] = [
    ...(bl.data?.items ?? []).map((r) => ({ key: r.requestId, queue: 'baseline' as const, item: `${r.featureId} ${r.version}`, detail: r.requestId, since: r.requestedAt, who: r.requestedBy, mine: has('BOM_APPROVER') && r.requestedBy !== me.id, why: null, to: `/baselines?request=${r.requestId}` })),
    ...(pol.data?.items ?? []).map((p) => ({ key: p.policyId, queue: 'policy' as const, item: `${p.policyId} · ${p.flagKey}`, detail: `${p.featureId} ${p.featureVersion}`, since: p.createdAt, who: p.createdBy, mine: has('FEATURE_APPROVER') && p.createdBy !== me.id, why: null, to: `/policies/${p.policyId}` })),
    ...(prod.data?.items ?? [])
      .filter((p) => p.lifecycle === 'PROPOSED' || p.lifecycle === 'VERIFIED')
      .map((p) => ({ key: `${p.catalogId}@${p.version}`, queue: 'product' as const, item: `${p.catalogId} ${p.version}`, detail: `${p.name} · ${p.lifecycle === 'PROPOSED' ? '구성 승인' : '고객 출시 승인'}`, since: null, who: null, mine: has('PRODUCT_APPROVER'), why: null, to: `/products/${p.catalogId}/${p.version}` })),
    ...(saf.data?.items ?? [])
      .filter((p) => p.status === 'DRAFT')
      .map((p) => ({ key: `safety:${p.featureId}@${p.version}`, queue: 'safety' as const, item: `${p.featureId} ${p.version}`, detail: p.fClass, since: null, who: null, mine: has('SAFETY_OFFICER'), why: null, to: `/features/${p.featureId}/${p.version}?tab=safety` })),
    ...(kills.data?.items ?? [])
      .filter((k) => k.status === 'REQUESTED')
      .map((k) => {
        const c = killCheck(k, 'deactivate');
        return { key: `kill:${k.killId}`, queue: 'kill' as const, item: k.killId, detail: `${k.featureId} ${k.featureVersion} · ${I.approvals((k.approvals ?? []).length, 2)}`, since: k.requestedAt, who: k.requestedBy, mine: c.ok, why: 'message' in c ? c.message : null, to: `/ops/kill?id=${k.killId}` };
      }),
    ...(kills.data?.items ?? [])
      .filter((k) => k.status === 'ACTIVE' && k.restoreRequest?.status === 'REQUESTED')
      .map((k) => {
        const c = killCheck(k, 'restore');
        return { key: `restore:${k.killId}`, queue: 'restore' as const, item: k.killId, detail: `${k.featureId} ${k.featureVersion} · ${I.approvals(k.restoreRequest!.approvals.length, 2)}`, since: k.restoreRequest!.requestedAt, who: k.restoreRequest!.requestedBy, mine: c.ok, why: 'message' in c ? c.message : null, to: `/ops/kill?id=${k.killId}` };
      }),
    ...(sync.data?.items ?? []).map((c) => ({ key: `sync:${c.conflictId}`, queue: 'sync' as const, item: `${c.system} ${c.key}`, detail: `${c.field}: ${c.platformValue} ↔ ${c.externalValue}`, since: c.createdAt, who: null, mine: has('IMPLEMENTER') || has('RELEASE_MANAGER') || has('FEATURE_APPROVER'), why: null, to: '/integration/connectors?tab=sync' })),
  ];
  const failed = queries.find((q) => q.isError);
  // 여러 큐를 합친다 — 하나라도 실패하면 그 상태(권한 거부면 forbidden)를 그대로 보인다
  const state: AsyncState = failed ? asyncState(failed) : queries.some((q) => q.isPending) ? 'loading' : items.length ? 'ready' : 'empty';
  return { items, queries, state, loading: queries.some((q) => q.isPending), error: failed?.error ?? null, retry: () => queries.forEach((q) => q.isError && q.refetch()) };
}

export function ApprovalInboxScreen() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { role } = useAppShell();
  const proc = useProcedureSummary(role);
  const inbox = useInbox();
  const rows = scope === 'mine' ? inbox.items.filter((i) => i.mine) : inbox.items;
  const mineCount = inbox.items.filter((i) => i.mine).length;
  const C = I.col;
  const queues = Object.keys(I.queues) as Extract<keyof typeof I.queues, string>[];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · D01-03 · D01-06 · D03-03 · D03-04"
        title={I.title}
        lead={I.lead}
        message={inbox.loading ? { tone: 'neutral', value: '—', text: I.key.mine } : mineCount ? { tone: 'warn', value: mineCount, text: I.key.mine } : { tone: 'ok', text: I.key.clear }}
        actions={<Segmented label={I.scope} options={(['mine', 'all'] as const).map((v) => ({ value: v, label: I.scopes[v], count: v === 'all' ? inbox.items.length : undefined }))} value={scope} onChange={(v) => setScope(v as typeof scope)} />}
      />
      {proc && proc.review > 0 && (
        <Panel title={PR.inbox.title} eyebrow={PR.inbox.hint} actions={<Link to="/procedures">{PR.inbox.open}</Link>}>
          <p>{PR.inbox.summary(proc.review, proc.overdue)}</p>
        </Panel>
      )}
      {/* 내 차례 범위가 비면 핵심 메시지가 이미 "내 차례인 … 없습니다"라고 말한다 — 빈 상자로 되풀이하지 않는다(UX3-09) */}
      <AsyncView state={inbox.state === 'ready' && rows.length === 0 ? 'empty' : inbox.state} empty={{ title: I.empty }} emptyHidden={scope === 'mine'} error={inbox.error?.message} onRetry={inbox.retry}>
        {queues
          .filter((q) => rows.some((r) => r.queue === q))
          .map((q) => (
            <Panel key={q} title={I.queues[q]} eyebrow={I.roles[q]} id={`inbox-${q}`}>
              <DataTable
                caption={I.queues[q]}
                rows={rows.filter((r) => r.queue === q)}
                rowKey={(r) => r.key}
                columns={[
                  { key: 'i', header: C.item, cell: (r) => <span className="ds-mono ds-nowrap">{r.item}</span> },
                  { key: 'd', header: C.detail, cell: (r) => r.detail },
                  { key: 's', header: C.since, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{t16(r.since)}</span> },
                  { key: 'w', header: C.who, cell: (r) => <span className="ds-mono">{r.who ?? '—'}</span> },
                  { key: 'm', header: C.me, cell: (r) => (r.mine ? <VerdictBadge value="PASS" /> : <span className="ds-field__hint">{r.why ?? '—'}</span>) },
                  { key: 'g', header: C.go, cell: (r) => <Link to={r.to}>{I.open}</Link> },
                ]}
              />
            </Panel>
          ))}
      </AsyncView>
    </div>
  );
}

// ───────── 내 대시보드 ─────────

/** 핵심 메시지 — 걸린 긴급 차단이 가장 먼저, 없으면 내 차례인 검토 */
function homeMessage(activeKills: number, mine: number, procMine: number, loaded: boolean): KeyMessageSpec {
  const H = ko.master.home;
  // 데이터가 오기 전에는 판정하지 않는다 — 빈 목록을 '없음'으로 읽으면 거짓 안심
  if (!loaded) return { tone: 'neutral', value: '—', text: H.key.inbox };
  if (activeKills) return { tone: 'danger', value: activeKills, text: H.key.kills, action: <Link to="/ops/kill">{H.key.open}</Link> };
  if (mine) return { tone: 'warn', value: mine, text: H.key.inbox, action: <Link to="/admin/approval">{H.key.open}</Link> };
  if (procMine) return { tone: 'warn', value: procMine, text: PR.inbox.title, action: <Link to="/procedures">{PR.inbox.go}</Link> };
  return { tone: 'ok', text: H.key.clear };
}

export function HomeScreen() {
  const H = ko.master.home;
  const { role } = useAppShell();
  const proc = useProcedureSummary(role);
  const inbox = useInbox();
  const feats = useApi<{ items: { featureId: string; version: string; lifecycle: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const pols = useApi<{ items: { status: string }[] }>('listPolicies', { query: { status: 'DEPLOYED' } });
  const kills = useApi<{ items: { reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const anms = useApi<{ items: { status: string }[] }>('anomalies');
  const fleet = useApi<{ items: { fleet?: string }[] }>('vehicles');
  // 5년 운영 데이터면 대상 차량은 모집단 모델(가정값)에서 — 시연·수신 차량 행 수가 아니다
  const pop = useApi<{ dataset: { kind: string }; funnel: { active: number } }>('fleetPopulation', {}, { staleTime: 300_000 });
  const target = pop.data?.dataset?.kind === 'ops5y' && typeof pop.data.funnel?.active === 'number' ? pop.data.funnel.active : null;
  const f = feats.data?.items ?? [];
  const byLc = f.reduce<Record<string, number>>((m, x) => ((m[x.lifecycle] = (m[x.lifecycle] ?? 0) + 1), m), {});
  // 상업 비활성화(체험 만료 등)는 긴급 차단이 아니다 — 5년 운영이면 수십 건이 늘 걸려 있다
  const activeKills = (kills.data?.items ?? []).filter((k) => k.reasonCategory !== 'COMMERCIAL').length;
  const mine = inbox.items.filter((i) => i.mine).length;
  const procMine = proc ? proc.todo + proc.review : 0;
  const procValue = proc ? procMine : '—';
  const LINKS: [string, string][] = [
    ['/admin/approval', I.title],
    ['/features', 'Feature Registry'],
    ['/fleet/live', ko.fleet.title],
    ['/ops/kill', ko.kill.title],
    ['/integration/openfeature', 'OpenFeature'],
  ];
  return (
    <div className="ds-screen">
      <PageHeader title={H.title} lead={H.lead} message={homeMessage(activeKills, mine, procMine, !!kills.data && !inbox.loading)} />
      <DashboardHero />
      <SummaryLine
        items={[
          { k: PR.inbox.title, v: procValue },
          { k: H.kpi.features, v: f.length },
          { k: H.kpi.released, v: byLc.RELEASED ?? 0 },
          { k: H.kpi.policies, v: pols.data?.items.length ?? '—' },
          { k: H.kpi.anomalies, v: (anms.data?.items ?? []).filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED').length },
          ...(target !== null ? [{ k: O.target, v: <span title={formatExact(target)}>{formatCount(target)}</span> }] : []),
          // 수신 표본(SAMPLE)은 시연 Fleet이 아니다
          { k: H.kpi.online, v: fleet.data ? fleet.data.items.filter((v) => v.fleet !== 'SAMPLE').length : '—' },
        ]}
      />
      <ProcedureMap summary={proc} role={role} />
      <div className="ds-split">
        <Panel title={H.lifecycle} id="home-lc">
          {/* Registry와 같은 범위(최신 Version) — 누르면 같은 수의 행이 보인다 */}
          <ul className="ds-chain ds-linklist">
            {LIFECYCLE.filter((lc) => byLc[lc]).map((lc) => [lc, byLc[lc]] as const).map(([lc, n]) => (
              <li key={lc} style={{ listStyle: 'none' }}>
                <Link to={`/features?lifecycle=${lc}`}>
                  <LifecycleBadge value={lc} /> <span className="ds-mono">{n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={H.links} id="home-links">
          <ul className="ds-linklist">
            {LINKS.map(([to, label]) => (
              <li key={to}>
                <Link to={to}>{label}</Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// ───────── Feature 제안 · 등록 ─────────

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function ProposeScreen() {
  const P = ko.master.propose;
  const nav = useNavigate();
  const perm = usePermission(['FEATURE_AUTHOR']);
  const create = useApiMutation<{ featureId: string; version: string }>('createFeature', ['listFeatures', 'events', 'audit']);
  const [f, setF] = useState({ name: '', description: '', requirementIds: '', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: '', asil: 'QM', tags: '', upgVc: '' });
  const [cps, setCps] = useState<string[]>(['Flag']);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const text = (k: keyof typeof f, label: string, wide = false) => (
    <Field label={label}>
      <input className={`ds-input${wide ? '' : ' ds-input--mono'}`} name={k} value={f[k]} onChange={set(k)} />
    </Field>
  );
  return (
    <div className="ds-screen">
      <PageHeader codes="D01-01 · PROPOSED 0.1.0" title={P.title} lead={P.lead} message={{ tone: 'neutral', text: perm.ok ? P.key.can : P.key.cannot }} />
      <Panel id="propose-form" tour="feature-form">
        <div className="ds-split">
          <div className="ds-stack">
            <Field label={P.name}>
              <input className="ds-input" name="name" value={f.name} onChange={set('name')} />
            </Field>
            <Field label={P.description}>
              <textarea className="ds-input" name="description" value={f.description} onChange={set('description')} rows={3} />
            </Field>
            {text('requirementIds', P.requirements)}
            {text('tags', P.tags)}
          </div>
          <div className="ds-stack">
            {text('country', P.country)}
            {text('vehicleModel', P.vehicleModel)}
            {text('trim', P.trim)}
            <Field label={P.owner}>
              <input className="ds-input" name="ownerId" value={f.ownerId} onChange={set('ownerId')} />
            </Field>
            <Select label={P.asil} value={f.asil} onChange={set('asil')}>
              {['QM', 'A', 'B', 'C', 'D'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
            {text('upgVc', P.upgVc)}
            <fieldset className="ds-choices" aria-label={P.cps}>
              <legend className="ds-field__label">{P.cps}</legend>
              {['Flag', 'Parameter', 'Signal', 'DTC'].map((c) => (
                <label key={c}>
                  <input type="checkbox" checked={cps.includes(c)} onChange={() => setCps((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]))} />
                  {c}
                </label>
              ))}
            </fieldset>
          </div>
        </div>
        <ErrorNote error={create.error} />
        <Button
          variant="primary"
          data-ui="createFeature"
          disabled={!perm.ok || STATIC_MODE || !f.name.trim() || !f.description.trim() || !f.ownerId.trim() || create.isPending}
          title={perm.hint}
          onClick={() =>
            create.mutate(
              { body: { name: f.name.trim(), description: f.description.trim(), requirementIds: list(f.requirementIds), country: f.country.trim(), vehicleModel: f.vehicleModel.trim(), trim: f.trim.trim(), ownerId: f.ownerId.trim(), asil: f.asil, tags: list(f.tags), upgVc: list(f.upgVc), controlPoints: cps } },
              { onSuccess: (r) => nav(`/features/${r.featureId}/${r.version}`) },
            )
          }
        >
          {P.submit}
        </Button>
      </Panel>
    </div>
  );
}

export function DefineScreen() {
  const D = ko.master.define;
  const q = useApi<{ items: { featureId: string; version: string; name: string; lifecycle: string; ownerId: string; gates?: Record<string, string> }[] }>('listFeatures', { query: { latestOnly: true } });
  const rows = (q.data?.items ?? []).filter((f) => f.lifecycle !== 'RELEASED' && f.lifecycle !== 'RETIRED' && f.lifecycle !== 'DEPRECATED');
  const C = D.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · Registry"
        title={D.title}
        lead={D.lead}
        message={q.data ? (rows.length ? { tone: 'neutral', value: rows.length, text: D.key.open } : { tone: 'neutral', text: D.key.none }) : { tone: 'neutral', value: '—', text: D.key.open }}
        actions={<Link to="/feature/propose">{D.newProposal}</Link>}
      />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={D.title}
          rows={rows}
          rowKey={(r) => `${r.featureId}@${r.version}`}
          maxHeight="66vh"
          columns={[
            { key: 'f', header: C.feature, cell: (r) => <span className="ds-nowrap"><Link to={`/features/${r.featureId}/${r.version}`} className="ds-mono">{`${r.featureId} ${r.version}`}</Link> {r.name}</span>, sort: (r) => r.featureId },
            { key: 'l', header: C.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => r.lifecycle },
            { key: 'o', header: C.owner, cell: (r) => <span className="ds-nowrap">{r.ownerId}</span> },
            { key: 'g', header: C.gates, cell: (r) => <span className="ds-mono">{D.gatePass(Object.values(r.gates ?? {}).filter((v) => v === 'PASS').length)}</span>, sort: (r) => Object.values(r.gates ?? {}).filter((v) => v === 'PASS').length },
            { key: 'n', header: C.next, cell: (r) => D.next[r.lifecycle] ?? '—' },
          ]}
        />
      </AsyncView>
    </div>
  );
}
