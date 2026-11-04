// 작업공간 공통 — 부서의 활동(업무 절차 문서, 필요할 때만 불러온다)·내 업무 목록·부서 간 인계.
import { Link } from 'react-router-dom';
import type { DepartmentSummary, RaciKey, WorkflowActivity, WorkflowDepartment, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { departments as D } from '../../copy/departments';
import { AsyncView } from '../../design';
import { departmentById } from '../../data/departments';
import { useProgress } from '../../data/procedureProgress';
import { useWorkflows } from '../../data/workflows';
import { useAppShell } from '../../store';

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

export const activityHref = (a: DeptActivity) => `/procedures/${a.process.id}?a=${a.activity.id}`;

/** 내 업무 — 이 부서가 수행·책임지는 활동. 1차 범위(핵심 생애주기)를 먼저, 끝난 활동은 표시 */
export function MyWork({ d, limit = 8, dense = false }: { d: DeptDoc | null | 'fail'; limit?: number; dense?: boolean }) {
  const { role } = useAppShell();
  const progress = useProgress(role);
  const ready = d && d !== 'fail' ? d : null;
  const mine = ready ? ready.acts.filter((a) => a.part === 'R' || a.part === 'A').sort((a, b) => Number(b.firstScope) - Number(a.firstScope)) : [];
  return (
    <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : mine.length ? 'ready' : 'empty'} empty={{ title: D.home.myWorkEmpty }} rows={4}>
      <ol className={`ws-work${dense ? ' ws-work--dense' : ''}`}>
        {mine.slice(0, limit).map((a) => (
          <li key={a.activity.id} data-done={progress.isDone(a.activity.id) ? '' : undefined}>
            <span className="ws-part" data-part={a.parts.includes('A') ? 'A' : a.part}>
              {a.parts.includes('R') && a.parts.includes('A') ? D.home.partRA : D.part[a.part]}
            </span>
            <Link to={activityHref(a)} className="ws-work__name">
              {a.activity.name}
            </Link>
            <span className="ws-work__proc">
              {a.process.name}
              {!a.firstScope && <em> · {D.home.secondScope}</em>}
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

/** 부서 경계를 넘는 인계 — 받는 것과 보내는 것, 상대 부서 이름으로 */
export function Handoffs({ d }: { d: DeptDoc | null | 'fail' }) {
  const ready = d && d !== 'fail' ? d : null;
  const name = (id: string) => ready?.doc.processes.flatMap((p) => p.activities).find((a) => a.id === id)?.name ?? id;
  const dept = (id: string) => departmentById(id)?.name ?? id;
  const list = (k: 'in' | 'out') => ready?.full.handoffs[k] ?? [];
  const empty = ready ? !list('in').length && !list('out').length : false;
  return (
    <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : empty ? 'empty' : 'ready'} empty={{ title: '—' }} rows={3}>
      <div className="ws-hand">
        {(['in', 'out'] as const).map((k) =>
          list(k).length ? (
            <div key={k}>
              <p className="ws-hand__title">{k === 'in' ? D.home.handoffIn : D.home.handoffOut}</p>
              <ul>
                {list(k).slice(0, 6).map((h) => (
                  <li key={`${h.from}-${h.to}-${h.department}`}>
                    <span className="ws-hand__dept">{k === 'in' ? D.home.from(dept(h.department)) : D.home.to(dept(h.department))}</span>
                    <span>{k === 'in' ? name(h.to) : name(h.from)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </AsyncView>
  );
}
