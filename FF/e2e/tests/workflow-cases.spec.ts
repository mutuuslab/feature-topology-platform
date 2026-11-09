// Actual HTTP persistence and production UI; generic acceptance must not change native approval state.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { WORKFLOW_EXECUTION_MODEL as MODEL } from '../../contracts/src/generated/workflow-execution-model';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const headers = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const SYS = headers('usr-sysadmin', 'SYSTEM_ADMIN'), AUTHOR = headers('usr-commerce', 'PRODUCT_AUTHOR');
const REVIEWER = headers('usr-integrator', 'IMPLEMENTER'), OPS = headers('usr-operator', 'OPERATOR');
const ACT = 'FPW.18-A01', NEXT = 'FPW.18-A02', WP = 'WP-ANALYSIS-SCOPE';
const fields = () => Object.fromEntries(MODEL.processes.find(p => p.id === 'FPW.18')!.products.find(p => p.key === WP)!.content.map((_, i) => [String(i), `E2E scope evidence ${i}`]));
const create = (request: APIRequestContext) => request.post(`${API}/api/workflow/cases`, { headers: AUTHOR, data: { processId: 'FPW.18', title: 'E2E actual analysis handoff', targetRef: 'FEAT-00022@1.0.0' } });
const grant = (request: APIRequestContext, accountId: string, roleId: string, active: boolean) => request.post(`${API}/api/workflow/roles`, { headers: SYS, data: { accountId, roleId, active, reason: 'E2E isolated role assignment and restoration' } });
async function previousGrant(request: APIRequestContext, accountId: string, roleId: string) {
  const res = await request.get(`${API}/api/workflow/roles`, { headers: SYS });
  expect(res.status()).toBe(200);
  return !!(await res.json()).items.find((g: any) => g.accountId === accountId && g.roleId === roleId)?.active;
}

test.describe('Actual workflow case persistence and boundaries', () => {
  test.describe.configure({ mode: 'default' });

  test('file bytes → independent review → idempotent handoff → receiving operator → UI download', async ({ request, page }) => {
    const prior = await previousGrant(request, 'usr-integrator', 'R-DPO');
    const featureUrl = `${API}/api/features/FEAT-00022/versions/1.0.0`;
    const before = (await (await request.get(featureUrl)).json()).feature.lifecycle;
    try {
      const res = await create(request); expect(res.status()).toBe(201);
      const id = (await res.json()).item.caseId, root = `${API}/api/workflow/cases/${id}`;
      const bytes = Buffer.from('E2E immutable attachment: 실제 산출물 근거');
      const saved = await request.post(`${root}/artifacts`, { headers: AUTHOR, data: { version: 1, activityId: ACT, productKey: WP, fields: fields(), references: [], files: [{ name: 'scope-evidence.txt', mediaType: 'text/plain', base64: bytes.toString('base64') }], reason: 'E2E actual evidence' } });
      expect(saved.status()).toBe(201);
      expect((await saved.json()).item.artifacts[0].files[0]).toMatchObject({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      expect((await request.post(`${root}/activities/${ACT}/submit`, { headers: AUTHOR, data: { version: 2, note: 'E2E independent review request' } })).status()).toBe(201);
      expect((await request.post(`${root}/activities/${ACT}/review`, { headers: AUTHOR, data: { version: 3, decision: 'ACCEPT', reason: 'E2E self-review must fail' } })).status()).toBe(403);
      expect((await grant(request, 'usr-integrator', 'R-DPO', true)).status()).toBe(201);
      expect((await request.post(`${root}/activities/${ACT}/review`, { headers: REVIEWER, data: { version: 3, decision: 'ACCEPT', reason: 'E2E separate reviewer' } })).status()).toBe(201);
      const body = { version: 4, requestKey: `e2e-${id}`, fromActivityId: ACT, toActivityId: NEXT, note: 'E2E operator handoff' };
      const offered = await request.post(`${root}/handoffs`, { headers: AUTHOR, data: body }); expect(offered.status()).toBe(201);
      const first = await offered.json();
      const retried = await request.post(`${root}/handoffs`, { headers: AUTHOR, data: body }); expect(retried.status()).toBe(201);
      expect((await retried.json()).item.handoffs).toEqual(first.item.handoffs);
      const hid = first.item.handoffs[0].handoffId;
      expect((await request.post(`${root}/handoffs/${hid}/receive`, { headers: AUTHOR, data: { version: 5, decision: 'ACCEPT', reason: 'E2E sender cannot receive' } })).status()).toBe(403);
      const received = await request.post(`${root}/handoffs/${hid}/receive`, { headers: OPS, data: { version: 5, decision: 'ACCEPT', reason: 'E2E receiving operator verified evidence' } });
      expect(received.status()).toBe(201);
      const final = await received.json(); expect(final.item.handoffs[0].status).toBe('ACCEPTED');
      expect(final.history.filter((h: any) => h.action === 'WORKFLOW_HANDOFF_OFFER')).toHaveLength(1);
      expect((await (await request.get(featureUrl)).json()).feature.lifecycle).toBe(before);
      await page.addInitScript(() => localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator', department: 'ALL' })));
      await page.goto(`/procedures/work?case=${id}`);
      await expect(page.getByRole('heading', { name: '업무 건·산출물', exact: true })).toBeVisible();
      await page.getByRole('combobox', { name: '처리할 활동', exact: true }).selectOption(ACT);
      await expect(page.getByText('scope-evidence.txt', { exact: false }).first()).toBeVisible();
      const downloadButton = page.getByRole('button', { name: '첨부 다운로드 · scope-evidence.txt', exact: true });
      await expect(downloadButton).toBeEnabled();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), downloadButton.click()]);
      expect(await readFile((await download.path())!)).toEqual(bytes);
    } finally { expect((await grant(request, 'usr-integrator', 'R-DPO', prior)).status()).toBe(201); }
  });

  test('two real actors writing one version preserve exactly one artifact and return 412 to the other', async ({ request }) => {
    const prior = await previousGrant(request, 'usr-productowner', 'R-PDA');
    try {
      expect((await grant(request, 'usr-productowner', 'R-PDA', true)).status()).toBe(201);
      const created = await create(request); expect(created.status()).toBe(201);
      const id = (await created.json()).item.caseId, root = `${API}/api/workflow/cases/${id}`;
      const data = { version: 1, activityId: ACT, productKey: WP, fields: fields(), references: ['E2E-CONCURRENT-EVIDENCE'], files: [], reason: 'E2E concurrent edit' };
      const results = await Promise.all([request.post(`${root}/artifacts`, { headers: AUTHOR, data }), request.post(`${root}/artifacts`, { headers: headers('usr-productowner', 'PRODUCT_APPROVER'), data })]);
      expect(results.map(r => r.status()).sort()).toEqual([201, 412]);
      const persisted = await request.get(root, { headers: AUTHOR }); expect(persisted.status()).toBe(200);
      const saved = await persisted.json(); expect(saved.item.version).toBe(2); expect(saved.item.artifacts).toHaveLength(1);
      expect(saved.history.filter((h: any) => h.action === 'WORKFLOW_ARTIFACT_CREATE')).toHaveLength(1);
    } finally { expect((await grant(request, 'usr-productowner', 'R-PDA', prior)).status()).toBe(201); }
  });

  test('missing evidence and an unknown account fail without advancing the case', async ({ request }) => {
    const created = await create(request); expect(created.status()).toBe(201);
    const id = (await created.json()).item.caseId, root = `${API}/api/workflow/cases/${id}`;
    expect((await request.post(`${root}/activities/${ACT}/submit`, { headers: AUTHOR, data: { version: 1, note: 'E2E missing required evidence' } })).status()).toBe(422);
    expect((await request.post(`${API}/api/workflow/cases`, { headers: headers('e2e-unconfirmed-account', 'PRODUCT_AUTHOR'), data: { processId: 'FPW.18', title: 'Must not be created', targetRef: 'UNKNOWN' } })).status()).toBe(403);
    const saved = await request.get(root, { headers: AUTHOR }); expect(saved.status()).toBe(200);
    const item = (await saved.json()).item; expect(item.version).toBe(1); expect(item.artifacts).toEqual([]);
  });
});
