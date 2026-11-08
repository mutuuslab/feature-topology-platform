// 작업공간 공통 — 부서의 활동(업무 절차 문서, 필요할 때만 불러온다)·내 업무 목록·부서 간 인계.
// W2(P2-5·P1-11·P1-13·P1-4): '내 업무'는 지금 역할(부서 안 R&R)이 맡는 활동만, 링크는 일하는 화면으로 바로(절차 문서는 보조),
// 인계는 받는·보내는 활동의 화면 링크, 역할별 '내 차례 대기열' 칸과 핵심 메시지.
import { Link } from 'react-router-dom';
import type { DepartmentSummary, RaciKey, WorkflowActivity, WorkflowDepartment, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { departments as D } from '../../copy/departments';
import { homeWork as HW, QUEUE_LABEL, type QueueKey } from '../../copy/inbox';
import { AsyncView } from '../../design';
import { DEPARTMENTS, departmentById } from '../../data/departments';
import { useProgress } from '../../data/procedureProgress';
import { useWorkflows } from '../../data/workflows';
import { menuRouteOf } from '../../shell/departmentMenu';
import { useAppShell } from '../../store';
import { useInbox } from '../home/Inbox';
import { inDept, ROLE_FOCUS } from '../home/queues';
import { OIDC_AUTH } from '../../auth-mode';
import { rolesFor } from '../../api/actor';
import { workspaceData as W } from '../../copy/workspace-data';

export interface DeptActivity {
  process: WorkflowProcess;
  activity: WorkflowActivity;
  part: RaciKey;
  parts: RaciKey[];
  firstScope: boolean;
}

export interface DeptDoc {
  doc: WorkflowDoc;
  full: WorkflowDepartment;
  acts: DeptActivity[];
}

/** null = 불러오는 중, 'fail' = 실패 */
export function useDeptDoc(dept: DepartmentSummary): DeptDoc | null | 'fail' {
  const doc = useWorkflows();
  if (doc === null) return null;
  if (doc === 'fail') return 'fail';
  const full = doc.departments.find((d) => d.id === dept.id);
  if (!full) return 'fail';
  const byId = new Map(doc.processes.flatMap((p) => p.activities.map((a) => [a.id, { process: p, activity: a }] as const)));
  const acts = full.activities.flatMap((x) => {
    const hit = byId.get(x.id);
    return hit ? [{ ...hit, part: x.part, parts: x.parts, firstScope: x.firstScope }] : [];
  });
  return { doc, full, acts };
}

export const deptState = (d: DeptDoc | null | 'fail') => (d === null ? 'loading' : d === 'fail' ? 'error' : 'ready');

/** 업무 절차 문서의 활동 위치 — 보조 링크 */
export const activityHref = (a: Pick<DeptActivity, 'process' | 'activity'>) => `/procedures/${a.process.id}?a=${a.activity.id}`;

/** 활동을 하는 화면 — 매개변수 없는 화면이면 그대로, 대상별 화면(/features/:id/:ver)이면 판정·승인은 검토함, 그 밖은 메뉴 화면 */
export function workHref(a: Pick<DeptActivity, 'process' | 'activity'>): string {
  const screens = a.activity.platform?.screens ?? [];
  const plain = screens.find((s) => !s.includes(':') && menuRouteOf(s));
  if (plain) return plain;
  const first = screens[0];
  if (first) {
    const judging = !!a.activity.gateDecision || (a.activity.platform?.actions ?? []).some((x) => /^(transition|judgeGate|decide|approve|sign)/i.test(x));
    if (judging && first.startsWith('/features/')) return '/admin/approval';
    const m = menuRouteOf(first)?.menu;
    if (m) return m;
  }
  return activityHref(a);
}

/** Organization duties are the department intersection, never an empty-result fallback to all duties. */
export function myOrgRoles(d: Pick<DeptDoc, 'doc' | 'full'>, role: string): string[] {
  if (OIDC_AUTH) {
    const granted = rolesFor(role);
    return d.doc.roles.filter((r) => d.full.roles.includes(r.id) && r.platformRoles.some((p) => granted.includes(p as never))).map((r) => r.id);
  }
  const all = d.doc.personas?.[role] ?? [];
  return all.filter((r) => d.full.roles.includes(r));
}

/** 이 활동을 지금 역할이 수행(R)·책임(A)지는가 */
const doesIt = (a: DeptActivity, org: readonly string[]) => a.activity.raci.R.some((r) => org.includes(r)) || org.includes(a.activity.raci.A);

/** 내 업무 — 이 부서에서 지금 역할이 수행·책임지는 활동. 1차 범위(핵심 생애주기)를 먼저, 끝난 활동은 표시 */
export function MyWork({ d, limit = 8, dense = false }: { d: DeptDoc | null | 'fail'; limit?: number; dense?: boolean }) {
  const { role } = useAppShell();
  const progress = useProgress(role);
  const ready = d && d !== 'fail' ? d : null;
  const deptMine = ready ? ready.acts.filter((a) => a.part === 'R' || a.part === 'A') : [];
  const org = ready ? myOrgRoles(ready, role) : [];
  const byRole = deptMine.filter((a) => doesIt(a, org));
  const mine = byRole.sort((a, b) => Number(b.firstScope) - Number(a.firstScope));
  return (
    <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : mine.length ? 'ready' : 'empty'} empty={{ title: D.home.myWorkEmpty }} rows={4}>
      <p className="ds-field__hint">{W.modelWork}</p>
      <ol className={`ws-work${dense ? ' ws-work--dense' : ''}`} data-my-work={role}>
        {mine.slice(0, limit).map((a) => (
          <li key={a.activity.id} data-done={progress.isDone(a.activity.id) ? '' : undefined}>
            <span className="ws-part" data-part={a.parts.includes('A') ? 'A' : a.part}>
              {a.parts.includes('R') && a.parts.includes('A') ? D.home.partRA : D.part[a.part]}
            </span>
            <Link to={workHref(a)} className="ws-work__name" data-work-link>
              {a.activity.name}
            </Link>
            <span className="ws-work__proc">
              {a.process.name}
              {!a.firstScope && <em> · {D.home.secondScope}</em>}
              {' · '}
              <Link to={activityHref(a)} className="ws-work__doc" title={HW.procedureHint}>
                {HW.procedure}
              </Link>
            </span>
          </li>
        ))}
      </ol>
      {mine.length > limit && (
        <p className="ws-more">
          <Link to="/procedures">{D.home.procedures} →</Link>
        </p>
      )}
    </AsyncView>
  );
}

/** 부서 경계를 넘는 인계 — 받는 것과 보내는 것, 상대 부서 이름으로. 항목은 그 활동을 하는 화면으로 간다(P1-4) */
export function Handoffs({ d }: { d: DeptDoc | null | 'fail' }) {
  const ready = d && d !== 'fail' ? d : null;
  const acts = new Map((ready?.doc.processes ?? []).flatMap((p) => p.activities.map((a) => [a.id, { process: p, activity: a }] as const)));
  const name = (id: string) => acts.get(id)?.activity.name ?? id;
  const href = (id: string) => {
    const hit = acts.get(id);
    return hit ? workHref(hit) : '/procedures';
  };
  const dept = (id: string) => departmentById(id)?.name ?? id;
  const list = (k: 'in' | 'out') => ready?.full.handoffs[k] ?? [];
  const none = ready ? !list('in').length && !list('out').length : false;
  // 인계가 없는 부서(법무·개인정보) — 빈 칸 대신 의견·통보로 함께 하는 활동과 그 활동을 수행하는 부서(E5)
  const consults = ready && none ? ready.acts.filter((a) => a.part === 'C' || a.part === 'I') : [];
  const ownerOf = (a: DeptActivity) => DEPARTMENTS.departments.find((x) => x.roles.includes(a.activity.raci.R[0]))?.name ?? '';
  const empty = none && !consults.length;
  return (
    <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : empty ? 'empty' : 'ready'} empty={{ title: D.home.handoffNone }} rows={3}>
      <div className="ws-hand">
        {!!consults.length && (
          <div>
            <p className="ws-hand__title">{D.home.consults}</p>
            <ul>
              {consults.slice(0, 6).map((a) => (
                <li key={a.activity.id}>
                  <span className="ws-hand__dept">{D.home.from(ownerOf(a))}</span>
                  <Link to={workHref(a)} data-handoff-link>
                    {a.activity.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(['in', 'out'] as const).map((k) =>
          list(k).length ? (
            <div key={k}>
              <p className="ws-hand__title">{k === 'in' ? D.home.handoffIn : D.home.handoffOut}</p>
              <ul>
                {list(k).slice(0, 6).map((h) => {
                  // 받는 인계 — 내가 이어서 할 활동(to), 보내는 인계 — 내가 넘기는 활동(from)
                  const id = k === 'in' ? h.to : h.from;
                  return (
                    <li key={`${h.from}-${h.to}-${h.department}`}>
                      <span className="ws-hand__dept">{k === 'in' ? D.home.from(dept(h.department)) : D.home.to(dept(h.department))}</span>
                      <Link to={href(id)} data-handoff-link title={HW.handoffGo(name(id))}>
                        {name(id)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </AsyncView>
  );
}

/** 대기열 → 처리 화면(검토함의 그 대기열, Feature DB 검토는 변경 요청함) */
export const queueHref = (q: QueueKey) => (q === 'refReview' ? '/master/feature-db/changes?tab=OPEN' : `/admin/approval#inbox-${q}-h`) // 패널 제목 앵커;

/** 역할이 먼저 보는 대기열의 내 차례 수 — 홈 핵심 메시지·'내 차례 대기열' 칸 */
export function useRoleWork() {
  const { role, department } = useAppShell();
  const inbox = useInbox();
  const focus = ROLE_FOCUS[role] ?? [];
  const scoped = departmentById(department) ? inbox.items.filter((i) => inDept(i, department)) : inbox.items;
  const counts = focus.map((q) => ({ queue: q, n: scoped.filter((i) => i.queue === q && i.mine).length, first: scoped.find((i) => i.queue === q && i.mine) ?? null }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  return { loading: inbox.loading, state: inbox.state, error: inbox.error, retry: inbox.retry, focus, counts, total, labels: counts.filter((c) => c.n).map((c) => QUEUE_LABEL[c.queue]) };
}

/** 역할별 '내 차례 대기열' — 수와 처리하러 가는 링크(한 건이면 그 대상으로 바로). 불러오는 중은 '—'가 아니라 자리표시 */
export function RoleQueues({ work }: { work: ReturnType<typeof useRoleWork> }) {
  if (!work.focus.length) return null;
  return (
    <AsyncView state={work.error ? work.state : work.loading ? 'loading' : 'ready'} error={work.error} onRetry={work.retry}>
    <ul className="ws-fdb ws-roleq" aria-label={HW.tiles} data-role-queues>
      {work.counts.map((c) => (
        <li key={c.queue} data-queue={c.queue} data-busy={c.n ? '' : undefined}>
          <Link to={c.n === 1 && c.first ? c.first.to : queueHref(c.queue)}>
            <span className="ws-fdb__n" aria-busy={work.loading || undefined} data-loading={work.loading ? '' : undefined}>
              {work.loading ? HW.loading : c.n}
            </span>
            <span className="ws-fdb__label">{QUEUE_LABEL[c.queue]}</span>
          </Link>
        </li>
      ))}
    </ul>
    </AsyncView>
  );
}
