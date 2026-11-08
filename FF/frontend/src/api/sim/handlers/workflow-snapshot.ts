import type { WorkflowCaseDetail } from '@ff/contracts';
import type { SimReadContext } from '../types';

const loading = new WeakMap<object, Promise<void>>();
const MARKER = 'workflowSnapshotHydrated';
/** Seed read models without creating browser audit/approval events or assigning any roles. */
export async function hydrateWorkflowSnapshot(ctx: SimReadContext) {
  if (ctx.overlay.data[MARKER]) return;
  const pending = loading.get(ctx.overlay);
  if (pending) return pending;
  const load = (async () => {
    const list = await ctx.snapshot<{ items: { caseId: string }[] }>('workflowCases');
    const details: WorkflowCaseDetail[] = [];
    for (const row of list?.items ?? []) {
      const detail = await ctx.snapshot<WorkflowCaseDetail>('workflowCase', { id: row.caseId });
      if (!detail?.item || detail.item.caseId !== row.caseId) throw new Error('업무 건 스냅샷 상세가 목록과 일치하지 않습니다.');
      details.push(detail);
    }
    const cases = ctx.overlay.entities.workflowCase ??= {};
    const history = ctx.overlay.entities.workflowHistory ??= {};
    for (const detail of details) {
      // A persisted local edit wins. Resetting the demonstration restores the captured server records.
      if (!cases[detail.item.caseId]) cases[detail.item.caseId] = structuredClone(detail.item);
      for (const event of detail.history) if (!history[String(event.id)]) history[String(event.id)] = structuredClone(event);
    }
    ctx.overlay.data[MARKER] = true;
  })();
  loading.set(ctx.overlay, load);
  try { await load; } finally { loading.delete(ctx.overlay); }
}
