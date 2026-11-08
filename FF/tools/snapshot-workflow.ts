import type { SnapshotSave } from './snapshot-p3.ts';

/** Synthetic showcase only. Runtime readers still apply the requesting account's native RACI. */
export async function snapshotWorkflow(save: SnapshotSave) {
  const admin = { 'X-Actor-Id': 'usr-sysadmin', 'X-Actor-Role': 'SYSTEM_ADMIN' };
  const list = await save('workflowCases', {}, {}, admin);
  for (const item of list.items ?? []) {
    await save('workflowCase', { id: item.caseId }, {}, admin);
    await save('workflowCaseSources', { id: item.caseId }, {}, admin);
  }
}
