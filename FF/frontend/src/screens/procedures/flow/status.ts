// 흐름도 상자에 얹는 서버 상태 — 완료 / 지금 할 수 있음 / 앞 활동 대기 / 내 차례 / 기한 초과.
// 규칙은 서버 검토함과 같다: 준비 = 앞 활동(next 역방향)이 모두 끝났거나 사건으로 시작(contracts readyActivityIds),
// 기한 = 앞 활동 중 가장 늦은 완료 시각 + sla_hours(backend procedure.service readyAt/dueAt과 같은 계산).
import { predecessorsOf, raciOf, readyActivityIds, workflowIndexOf, type ProcedureCompletion, type WorkflowActivity, type WorkflowDoc, type WorkflowIndexDoc, type WorkflowPredecessors } from '@ff/contracts';

export type ActivityState = 'done' | 'overdue' | 'mine' | 'ready' | 'waiting';

export interface ActivityStatus {
  state: ActivityState;
  /** 내 역할이 수행(R)·책임(A) */
  mine: boolean;
  overdue: boolean;
  dueAt: string | null;
}

const INDEX = new WeakMap<WorkflowDoc, { index: WorkflowIndexDoc; preds: WorkflowPredecessors }>();
function indexOf(doc: WorkflowDoc) {
  let hit = INDEX.get(doc);
  if (!hit) {
    const index = workflowIndexOf(doc);
    hit = { index, preds: predecessorsOf(index) };
    INDEX.set(doc, hit);
  }
  return hit;
}

export const isMine = (a: WorkflowActivity, roleIds: readonly string[]) => {
  const k = raciOf(a, roleIds);
  return k === 'R' || k === 'A';
};

/** 모든 활동의 상태 — doc 전체를 한 번에(내 업무 흐름이 13개 절차를 함께 본다) */
export function activityStatuses(doc: WorkflowDoc, input: { done: ReadonlySet<string>; items: readonly ProcedureCompletion[]; roleIds: readonly string[]; now: number }): Map<string, ActivityStatus> {
  const { index, preds } = indexOf(doc);
  const ready = readyActivityIds(index, input.done, preds);
  const doneAt = new Map(input.items.map((i) => [i.activityId, i.completedAt]));
  const out = new Map<string, ActivityStatus>();
  for (const p of doc.processes)
    for (const a of p.activities) {
      const mine = isMine(a, input.roleIds);
      if (input.done.has(a.id)) {
        out.set(a.id, { state: 'done', mine, overdue: false, dueAt: null });
        continue;
      }
      if (!ready.has(a.id)) {
        out.set(a.id, { state: 'waiting', mine, overdue: false, dueAt: null });
        continue;
      }
      const ps = preds.get(a.id) ?? [];
      const times = ps.map((id) => doneAt.get(id)).filter((x): x is string => !!x);
      const readyAt = ps.length && times.length === ps.length ? times.sort().at(-1)! : null;
      const dueAt = readyAt && a.slaHours ? new Date(new Date(readyAt).getTime() + a.slaHours * 3_600_000).toISOString() : null;
      const overdue = !!dueAt && new Date(dueAt).getTime() < input.now;
      out.set(a.id, { state: overdue ? 'overdue' : mine ? 'mine' : 'ready', mine, overdue, dueAt });
    }
  return out;
}
