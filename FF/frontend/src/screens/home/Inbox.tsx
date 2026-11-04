// v2 (P10-C4) — / 내 대시보드 · /admin/approval 검토함 · /feature/propose Feature 제안 · /master/define Feature 등록.
// 검토함은 승인할 일을 모아 "내 차례인가"를 보이고 실제 승인은 각 화면에서 한다. 차단·복원의 내 차례 판정은 서버와 같은 contracts approvalCheck
// (요청자·이미 승인한 사람·FSM 칸·복원은 차단 승인자 제외 — FFG-PLT-005·DEAC-008).
// W2(담당자 E2E P2-3·P3-6): 정의 승인·Feature DB 검토·Release Sign-off·출시·배포·Gate 판정·사후 검토 대기열을 더하고, 급한 순서·기한·
// 사람 이름·한국 시각으로 보인다. 대기열 조건은 contracts(rules/work-queue), 부서·순서는 ./queues.
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { approvalCheck, approvalPlan, BaselineRequestStatus, GATE_META, postReviewBlocker, refChangeDutyBlocker, reportRolesOf, type Role, type WorkQueues } from '@ff/contracts';
import { actorFor, PLATFORM_ROLES } from '../../api/actor';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { inbox as IX, QUEUE_LABEL, QUEUE_ROLE, SLOT_LABEL } from '../../copy/inbox';
import { KIND_LABEL } from '../../copy/refdb';
import { procedures as PR } from '../../copy/procedures';
import { useProcedureSummary } from '../../data/procedureProgress';
import { localTime, personLabel, personName, remaining } from '../../data/people';
import { AsyncView, type AsyncState, DataTable, LifecycleBadge, PageHeader, Panel, Segmented, VerdictBadge, type KeyMessageSpec } from '../../design';
import { useAppShell } from '../../store';
import { OIDC_AUTH } from '../../auth-mode';
import { departmentById } from '../../data/departments';
import { DashboardPage } from './dashboard/Dashboard';
import { isSafetyKill } from './dashboard/catalog';
import { byUrgency, QUEUE_ORDER, type QueueItem } from './queues';

const I = ko.master.inbox;

type Item = QueueItem;

interface KillRow {
  killId: string;
  featureId: string;
  featureVersion: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt?: string | null;
  reasonCategory?: string;
  fClass?: string;
  approvals?: { approverId: string; role: string }[];
  restoreRequest?: { status: string; requestedBy: string; requestedAt: string; approvals: { approverId: string; role: string }[] } | null;
}

interface PostReviewRow {
  killId: string;
  featureId: string;
  due: string;
  requestedBy: string;
  approvers: string[];
  status: 'REVIEWED' | 'PENDING' | 'OVERDUE';
}

interface RefChangeRow {
  changeId: string;
  kind: string;
  refId: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  reviews?: { reviewerId: string }[];
}

interface PolicyRow {
  policyId: string;
  flagKey: string;
  featureId: string;
  featureVersion: string;
  status: string;
  createdBy: string;
  createdAt: string;
  approvedAt?: string | null;
}

const POST_REVIEW_ROLES: Role[] = ['AUDITOR', 'SECURITY_OFFICER', 'SAFETY_OFFICER', 'REGULATORY_OWNER'];

/** 정적 데모 스냅샷에 아직 없는 대기열(404)은 비어 있는 것으로 — 하나가 없다고 검토함 전체를 오류로 만들지 않는다 */
const optional = (q: { isError: boolean; error: { status: number } | null }) => q.isError && q.error?.status === 404;

const base = (p: Partial<Item> & Pick<Item, 'key' | 'queue' | 'item' | 'detail' | 'to' | 'mine'>): Item => ({ since: null, who: null, why: null, due: null, slot: null, featureId: null, gate: null, ...p });

/** 승인할 일 모으기 — 역할에 따라 내 차례 표시 */
export function useInbox() {
  const { role } = useAppShell();
  const mine = PLATFORM_ROLES[role] ?? [];
  const me = actorFor(role);
  const has = (r: Role) => mine.includes(r);
  const bl = useApi<{ items: { requestId: string; featureId: string; version: string; requestedBy: string; requestedAt: string }[] }>('baselineRequests', { query: { status: BaselineRequestStatus.enum.PENDING } });
  const pol = useApi<{ items: PolicyRow[] }>('listPolicies', { query: { status: 'VALIDATED' } });
  const approved = useApi<{ items: PolicyRow[] }>('listPolicies', { query: { status: 'APPROVED' } });
  const prod = useApi<{ items: { catalogId: string; version: string; name: string; lifecycle: string }[] }>('listProducts');
  const wq = useApi<Partial<WorkQueues>>('workQueues');
  const kills = useApi<{ items: KillRow[] }>('killRequests');
  const reviews = useApi<{ items: PostReviewRow[] }>('killPostReviews');
  const changes = useApi<{ items: RefChangeRow[] }>('listRefChanges', { query: { status: 'REVIEW' } });
  // GitLab·JIRA·codeBeamer 동기화 충돌 — 사람이 플랫폼 값·외부 값 중 골라야 한다
  const sync = useApi<{ items: { conflictId: number; system: string; key: string; field: string; platformValue: string; externalValue: string; createdAt: string }[] }>('extConflicts', { query: { status: 'OPEN' } });
  const queries = [bl, pol, approved, prod, wq, kills, reviews, changes, sync];
  const reportRoles = reportRolesOf(mine);
  const killCheck = (k: KillRow, request: 'deactivate' | 'restore') => {
    const rr = k.restoreRequest;
    const plan = approvalPlan((k.fClass ?? 'F0') as never, request, (k.reasonCategory ?? 'SAFETY') as never);
    const s = request === 'deactivate' ? { requestedBy: k.requestedBy, approvals: (k.approvals ?? []) as never[], plan } : { requestedBy: rr!.requestedBy, approvals: rr!.approvals as never[], plan, excluded: (k.approvals ?? []).map((a) => a.approverId) };
    return approvalCheck(s, { id: me.id, roles: reportRoles });
  };
  const w = wq.data ?? {};
  const items: Item[] = byUrgency([
    ...(bl.data?.items ?? []).map((r) => base({ key: r.requestId, queue: 'baseline', item: `${r.featureId} ${r.version}`, detail: r.requestId, since: r.requestedAt, who: r.requestedBy, mine: has('BOM_APPROVER') && r.requestedBy !== me.id, to: `/baselines?request=${r.requestId}`, featureId: r.featureId })),
    ...(pol.data?.items ?? []).map((p) => base({ key: p.policyId, queue: 'policy', item: `${p.policyId} · ${p.flagKey}`, detail: `${p.featureId} ${p.featureVersion}`, since: p.createdAt, who: p.createdBy, mine: has('FEATURE_APPROVER') && p.createdBy !== me.id, to: `/policies/${p.policyId}`, featureId: p.featureId })),
    ...(approved.data?.items ?? []).map((p) => base({ key: `deploy:${p.policyId}`, queue: 'deploy', item: `${p.policyId} · ${p.flagKey}`, detail: IX.deploy(p.flagKey), since: p.approvedAt ?? p.createdAt, who: p.createdBy, mine: has('RELEASE_MANAGER') || has('OPERATOR'), to: `/policies/${p.policyId}`, featureId: p.featureId })),
    ...(prod.data?.items ?? [])
      .filter((p) => p.lifecycle === 'PROPOSED' || p.lifecycle === 'VERIFIED')
      .map((p) => base({ key: `${p.catalogId}@${p.version}`, queue: 'product', item: `${p.catalogId} ${p.version}`, detail: `${p.name} · ${p.lifecycle === 'PROPOSED' ? '구성 승인' : '고객 출시 승인'}`, mine: has('PRODUCT_APPROVER'), to: `/products/${p.catalogId}/${p.version}` })),
    ...(w.definitions ?? []).map((f) => {
      const own = !!f.createdBy && f.createdBy === me.id;
      return base({ key: `def:${f.featureId}@${f.version}`, queue: 'definition', item: `${f.featureId} ${f.version}`, detail: IX.definition(f.createdBy ? personName(f.createdBy) : f.ownerId), since: f.since, who: f.createdBy, mine: has('FEATURE_APPROVER') && !own, why: own ? IX.ownDefinition : null, to: `/features/${f.featureId}/${f.version}`, featureId: f.featureId });
    }),
    ...(changes.data?.items ?? [])
      .filter((c) => c.status === 'REVIEW')
      .map((c) => {
        const block = refChangeDutyBlocker(c, me.id, 'REVIEW');
        const done = (c.reviews ?? []).some((r) => r.reviewerId === me.id);
        return base({ key: `ref:${c.changeId}`, queue: 'refReview', item: `${c.changeId} · ${c.refId}`, detail: IX.refReview(KIND_LABEL[c.kind as keyof typeof KIND_LABEL] ?? c.kind, personName(c.requestedBy)), since: c.requestedAt, who: c.requestedBy, mine: has('DOMAIN_REVIEWER') && !block && !done, why: block ?? (done ? IX.reviewed : null), to: `/master/feature-db/changes/${c.changeId}` });
      }),
    ...(w.signoffs ?? []).map((f) => base({ key: `sign:${f.featureId}@${f.version}`, queue: 'signoff', item: `${f.featureId} ${f.version}`, detail: f.stale ? IX.signedStale : `${f.name} — ${IX.signoff}`, since: f.since, mine: has('FEATURE_AUTHOR'), to: `/features/${f.featureId}/${f.version}`, featureId: f.featureId })),
    ...(w.releasable ?? []).map((f) => base({ key: `rel:${f.featureId}@${f.version}`, queue: 'release', item: `${f.featureId} ${f.version}`, detail: `${f.name} — ${IX.release(personName(f.signedBy))}`, since: f.since, who: f.signedBy, mine: has('RELEASE_MANAGER'), to: `/features/${f.featureId}/${f.version}`, featureId: f.featureId })),
    ...(w.gates ?? []).map((g) => base({ key: `gate:${g.featureId}@${g.version}:${g.gate}`, queue: 'gate', item: `${g.featureId} ${g.version}`, detail: `${IX.gate(g.gate, GATE_META[g.gate].name)} · ${g.name}`, since: g.since, mine: has('GATE_JUDGE') || has('SAFETY_OFFICER'), to: `/features/${g.featureId}/${g.version}?tab=gates`, featureId: g.featureId, gate: g.gate })),
    ...(w.classifications ?? []).map((p) => base({ key: `safety:${p.featureId}@${p.version}`, queue: 'safety', item: `${p.featureId} ${p.version}`, detail: `${IX.classification(p.fClass)} · ${p.name}`, since: p.since, mine: has('SAFETY_OFFICER'), to: `/features/${p.featureId}/${p.version}?tab=safety`, featureId: p.featureId })),
    ...(w.homologations ?? []).map((f) => base({ key: `homologation:${f.featureId}@${f.version}`, queue: 'homologation', item: `${f.featureId} ${f.version}`, detail: f.name, since: f.since, mine: has('REGULATORY_OWNER'), to: `/features/${f.featureId}/${f.version}?tab=safety#safety-analysis-h`, featureId: f.featureId })),
    ...(kills.data?.items ?? [])
      .filter((k) => k.status === 'REQUESTED')
      .map((k) => {
        const c = killCheck(k, 'deactivate');
        const slot = c.ok ? IX.slot(SLOT_LABEL[c.role] ?? c.role) : null;
        return base({ key: `kill:${k.killId}`, queue: 'kill', item: k.killId, detail: `${k.featureId} ${k.featureVersion} · ${IX.approvals((k.approvals ?? []).length, 2)}`, since: k.requestedAt, who: k.requestedBy, mine: c.ok, why: 'message' in c ? c.message : null, slot, due: k.expiresAt ?? null, to: `/ops/kill?id=${k.killId}`, featureId: k.featureId });
      }),
    ...(kills.data?.items ?? [])
      .filter((k) => k.status === 'ACTIVE' && k.restoreRequest?.status === 'REQUESTED')
      .map((k) => {
        const c = killCheck(k, 'restore');
        const slot = c.ok ? IX.slot(SLOT_LABEL[c.role] ?? c.role) : null;
        return base({ key: `restore:${k.killId}`, queue: 'restore', item: k.killId, detail: `${k.featureId} ${k.featureVersion} · ${IX.approvals(k.restoreRequest!.approvals.length, 2)}`, since: k.restoreRequest!.requestedAt, who: k.restoreRequest!.requestedBy, mine: c.ok, why: 'message' in c ? c.message : null, slot, to: `/ops/kill?id=${k.killId}`, featureId: k.featureId });
      }),
    ...(reviews.data?.items ?? [])
      .filter((r) => r.status !== 'REVIEWED')
      .map((r) => {
        const block = postReviewBlocker(r, me.id);
        return base({ key: `post:${r.killId}`, queue: 'postReview', item: r.killId, detail: `${r.featureId} · ${IX.postReview(personName(r.requestedBy))}`, who: r.requestedBy, due: r.due, mine: POST_REVIEW_ROLES.some(has) && !block, why: block, to: '/audit/oversight#post-reviews-h', featureId: r.featureId });
      }),
    ...(sync.data?.items ?? []).map((c) => base({ key: `sync:${c.conflictId}`, queue: 'sync', item: `${c.system} ${c.key}`, detail: `${c.field}: ${c.platformValue} ↔ ${c.externalValue}`, since: c.createdAt, mine: has('IMPLEMENTER') || has('RELEASE_MANAGER') || has('FEATURE_APPROVER'), to: '/integration/connectors?tab=sync' })),
  ]);
  const failed = queries.find((q) => q.isError && !optional(q));
  // 여러 큐를 합친다 — 하나라도 실패하면 그 상태(권한 거부면 forbidden)를 그대로 보인다
  const state: AsyncState = failed ? asyncState(failed) : queries.some((q) => q.isPending) ? 'loading' : items.length ? 'ready' : 'empty';
  return { items, queries, state, loading: queries.some((q) => q.isPending), error: failed?.error ?? null, retry: () => queries.forEach((q) => q.isError && q.refetch()) };
}

/** 기한 배지 — 남은 시간(30분 안이면 경고), 지나면 위험 */
export function DueBadge({ due }: { due: string | null }) {
  const r = remaining(due);
  if (!r) return null;
  return (
    <span className="ds-due" data-due={r.overdue ? 'over' : r.ms < 30 * 60_000 ? 'soon' : 'ok'} title={localTime(due)}>
      {r.overdue ? IX.due.over(r.text) : IX.due.left(r.text)}
    </span>
  );
}

/** 사람 — 이름(툴팁에 소속·역할). 계정 ID는 보이지 않는다 */
export function PersonName({ id }: { id: string | null | undefined }) {
  if (!id) return <>—</>;
  return <span title={personLabel(id)}>{personName(id)}</span>;
}

/** 내 차례 칸 — 가능하면 어느 칸으로인지, 아니면 이유 */
export function MineCell({ r }: { r: Item }) {
  if (r.mine)
    return (
      <span className="ds-nowrap">
        <VerdictBadge value="PASS" />
        {r.slot && <span className="ds-field__hint"> {r.slot}</span>}
      </span>
    );
  return <span className="ds-field__hint">{r.why ?? '—'}</span>;
}

export function ApprovalInboxScreen() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { role } = useAppShell();
  const proc = useProcedureSummary(role);
  const inbox = useInbox();
  const rows = scope === 'mine' ? inbox.items.filter((i) => i.mine) : inbox.items;
  const mineCount = inbox.items.filter((i) => i.mine).length;
  const C = I.col;
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
      <AsyncView state={inbox.state === 'ready' && rows.length === 0 ? 'empty' : inbox.state} empty={{ title: I.empty }} emptyHidden={scope === 'mine'} error={inbox.error} onRetry={inbox.retry}>
        {QUEUE_ORDER.filter((q) => rows.some((r) => r.queue === q)).map((q) => (
          <Panel key={q} title={QUEUE_LABEL[q]} eyebrow={QUEUE_ROLE[q]} id={`inbox-${q}`}>
            <DataTable
              caption={QUEUE_LABEL[q]}
              rows={rows.filter((r) => r.queue === q)}
              rowKey={(r) => r.key}
              columns={[
                { key: 'i', header: C.item, cell: (r) => <span className="ds-mono ds-nowrap">{r.item}</span> },
                { key: 'd', header: C.detail, cell: (r) => r.detail },
                { key: 'due', header: IX.col.due, cell: (r) => <DueBadge due={r.due} /> },
                { key: 's', header: C.since, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{localTime(r.since)}</span> },
                { key: 'w', header: C.who, cell: (r) => <PersonName id={r.who} /> },
                { key: 'm', header: C.me, cell: (r) => <MineCell r={r} /> },
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

// 부서 보기(데모)의 작업공간 홈 — 부서를 고른 사람만 불러온다(첫 화면 번들 밖)
// 운영 빌드(OIDC)는 부서 보기가 없다 — 지연 import 자체를 없애 묶음이 빠지게
const WorkspaceHome = OIDC_AUTH ? null : lazy(() => import('../workspaces/WorkspaceHome'));

export function HomeScreen() {
  const { department } = useAppShell();
  const dept = OIDC_AUTH ? undefined : departmentById(department);
  if (dept && WorkspaceHome)
    return (
      <Suspense fallback={<div className="ds-skel" data-state="loading"><span /><span /><span /></div>}>
        <WorkspaceHome key={dept.id} dept={dept} />
      </Suspense>
    );
  return <AllHome />;
}

/** 전체 보기 홈 — Jira식 대시보드(역할별 가젯) */
function AllHome() {
  const { role } = useAppShell();
  const proc = useProcedureSummary(role);
  const inbox = useInbox();
  const kills = useApi<{ items: { reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const activeKills = (kills.data?.items ?? []).filter(isSafetyKill).length;
  const mine = inbox.items.filter((i) => i.mine).length;
  const procMine = proc ? proc.todo + proc.review : 0;
  // Jira 대시보드 — 이름·바꾸기·별·편집·더 보기, 가젯 인스턴스·구성(서버 저장, 정적 데모는 이 브라우저). 핵심 메시지는 판 위에 하나
  return <DashboardPage role={role} message={homeMessage(activeKills, mine, procMine, !!kills.data && !inbox.loading)} />;
}

// ───────── Feature 제안 · 등록 ─────────

// Feature 제안 2단계(기준 기능 고르기 → 등록 정보 확인)는 propose/ — 홈 묶음을 키우지 않게 필요할 때 읽는다(경로 이름은 그대로)
const ProposeLazy = lazy(() => import('./propose/ProposeScreen'));
export function ProposeScreen() {
  return (
    <Suspense fallback={null}>
      <ProposeLazy />
    </Suspense>
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
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
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
