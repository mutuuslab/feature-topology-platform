// Flag 코드 연결·대사·통제(20-97 §8.2) — 시나리오 1~7을 실제 API로(시연 저장소 시드 + 모의 GitHub). 8(정적 설치)은 static.spec이
// menu.ts의 새 메뉴·하위 화면을 열어 스냅샷 누락 0을 본다. 상태를 바꾸므로 순서대로 한 작업자에서 돈다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { startMockGithub, type MockGithub } from '../../tools/flag-code/mock-github.ts';
import { settle } from './settle';

test.describe.configure({ mode: 'serial' });

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const GH_PORT = Number(process.env.E2E_GH_PORT ?? Number(process.env.E2E_API_PORT ?? 9111) + 2);
const SECRET = process.env.E2E_GH_WEBHOOK_SECRET ?? 'e2e-flag-webhook-secret';
const ACTOR: Record<string, [string, string]> = {
  integrator: ['usr-integrator', 'IMPLEMENTER'],
  coordinator: ['usr-coordinator', 'RELEASE_MANAGER'],
  approver: ['usr-approver', 'FEATURE_APPROVER'],
  viewer: ['usr-viewer', 'AUDITOR'],
};
const hdr = (who: keyof typeof ACTOR, role?: string) => ({ 'X-Actor-Id': ACTOR[who][0], 'X-Actor-Role': role ?? ACTOR[who][1] });
const get = async (request: APIRequestContext, path: string) => {
  const r = await request.get(API + path, { headers: hdr('viewer') });
  expect(r.ok(), `${path}: ${r.status()}`).toBe(true);
  return r.json();
};
async function as(page: Page, role: string) {
  await page.addInitScript((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}
async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('#main h1').first()).toBeVisible();
  await settle(page);
}
const row = async (request: APIRequestContext, flagKey: string) => (await get(request, `/api/flag-code/coverage/${flagKey}`)).row;

test('1 구현 담당 — PR 검토 중 Flag를 시연 병합하면 정상이 되고 push 스캔(서명)과 Feature 탭 커밋 링크가 생긴다', async ({ page, request }) => {
  const flag = 'ivi_00100_enable';
  expect((await row(request, flag)).status).toBe('PR_OPEN');
  await as(page, 'integrator');
  await open(page, '/flag-code?status=PR_OPEN');
  await page.getByRole('table', { name: 'Flag별 코드 연결' }).getByRole('link', { name: flag }).click();
  await expect(page).toHaveURL(new RegExp(`/flag-code/flags/${flag}$`));
  await expect(page.locator('.ds-key__status')).toHaveText('Flag PR 검토 중');
  await page.getByRole('button', { name: '시연 병합' }).first().click();
  // 병합되면 열린 PR이 사라져 버튼도 없어진다 — 코드 칸이 맞음으로 바뀌는 것으로 확인
  await expect(page.locator('[data-lane-name="CODE"]')).toHaveAttribute('data-lane', 'OK');
  await expect(page.locator('.ds-key__status')).not.toHaveText('Flag PR 검토 중');
  const after = await row(request, flag);
  expect(after.status).not.toBe('PR_OPEN');
  const commit: string = after.code.usages[0].commit;
  // 스캔 기록 — 방금 병합 커밋의 push 스캔, FF 스캐너 서명
  const scans = (await get(request, '/api/flag-code/scans')).items as { trigger: string; commit: string; attestation: { kind: string } | null }[];
  expect(scans.find((s) => s.commit === commit && s.trigger === 'PUSH')?.attestation?.kind).toBe('FF_SCANNER');
  await open(page, '/integration/code-scans');
  const hit = page.getByRole('table', { name: '스캔 실행' }).getByRole('row').filter({ hasText: commit.slice(0, 8) }).first();
  await expect(hit).toContainText('push');
  await expect(hit).toContainText('FF 스캐너 서명');
  // Feature 상세 Flag 탭 1단계 — 새 커밋 소스 링크
  await open(page, '/features/FEAT-00100/1.0.0?tab=flags');
  const card = page.locator(`#flag-${flag}`);
  await expect(card.locator(`.ff-source a[href*="${commit}"]`).first()).toBeVisible();
  await expect(page.getByTestId(`coverage-${flag}`)).toContainText('정상');
});

test('2 출시 담당 — 코드 없는 Flag가 있는 VERIFIED Version은 FLAG_CODE_MISSING으로 막히고 대사판으로 간다', async ({ page, request }) => {
  const f = await get(request, '/api/features/FEAT-00144/versions/3.3.0');
  const rel = (f.transitions as { to: string; blockers: { code: string }[] }[]).find((t) => t.to === 'RELEASED')!;
  expect(rel.blockers.map((b) => b.code)).toContain('FLAG_CODE_MISSING');
  await as(page, 'coordinator');
  await open(page, '/features/FEAT-00144/3.3.0');
  await page.getByRole('button', { name: 'RELEASED로 전이' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('Flag adas_00144_signal');
  await drawer.getByRole('link', { name: /어긋남 대사판에서 확인/ }).click();
  await expect(page).toHaveURL(/\/flag-code\/reconcile$/);
  await expect(page.getByRole('region', { name: '코드 없음' }).getByRole('link', { name: 'adas_00144_signal' })).toBeVisible();
});

test('3 해제 — 구현 담당 요청, 같은 계정 결정은 거부, Feature 승인자 승인 뒤 출시 관문은 해제·전이 미리 보기에서 차단이 사라진다', async ({ page, browser, request }) => {
  const flag = 'adas_00144_signal';
  await as(page, 'integrator');
  await open(page, `/flag-code/flags/${flag}`);
  await page.getByRole('button', { name: '출시 차단 해제 요청' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel(/사유\(10자 이상\)/).fill('차량 SW 다음 빌드에 호출을 넣고 재스캔합니다 — e2e');
  await drawer.getByRole('button', { name: '요청' }).click();
  await expect(page.getByRole('status').filter({ hasText: '해제를 요청했습니다' })).toBeVisible();
  const w = ((await get(request, '/api/flag-code/waivers?featureId=FEAT-00144')).items as { waiverId: string; state: string; requestedBy: string }[]).find((x) => x.state === 'REQUESTED')!;
  expect(w.requestedBy).toBe('usr-integrator');
  // 같은 계정(구현 담당이면서 Safety Manager 역할) — 화면은 이유와 함께 막고, 서버도 거부한다
  const box = page.getByTestId(`waiver-decide-${w.waiverId}`);
  await expect(box.getByRole('button', { name: '승인' })).toBeDisabled();
  await expect(box).toContainText('요청한 사람은 같은 해제를 결정할 수 없습니다');
  const self = await request.post(`${API}/api/flag-code/waivers/${w.waiverId}/decision`, { headers: { ...hdr('integrator', 'SAFETY_OFFICER'), 'Idempotency-Key': crypto.randomUUID() }, data: { decision: 'APPROVE', comment: '같은 사람' } });
  expect([403, 409, 422]).toContain(self.status());
  // Feature 승인자
  const ctx = await browser.newContext();
  const ap = await ctx.newPage();
  await as(ap, 'approver');
  await open(ap, '/flag-code/reconcile');
  const decide = ap.getByTestId(`waiver-decide-${w.waiverId}`);
  await decide.getByLabel(/결정 의견/).fill('다음 빌드 확인 조건으로 승인');
  await decide.getByRole('button', { name: '승인' }).click();
  await expect.poll(async () => ((await get(request, '/api/flag-code/waivers?featureId=FEAT-00144')).items as { waiverId: string; state: string }[]).find((x) => x.waiverId === w.waiverId)?.state).toBe('APPROVED');
  await open(ap, '/features/FEAT-00144/3.3.0?tab=flags');
  await expect(ap.getByTestId('flag-release-gate')).toContainText('해제 1개');
  await ctx.close();
  const f = await get(request, '/api/features/FEAT-00144/versions/3.3.0');
  const rel = (f.transitions as { to: string; blockers: { code: string }[] }[]).find((t) => t.to === 'RELEASED')!;
  expect(rel.blockers.map((b) => b.code)).not.toContain('FLAG_CODE_MISSING');
});

test.describe('4 PR 검사 — 모의 GitHub', () => {
  let gh: MockGithub;
  const FULL = 'mutuuslab/vehicle-apps-e2e';
  test.beforeAll(async () => {
    gh = await startMockGithub({ port: GH_PORT });
  });
  test.afterAll(async () => gh?.close());

  test('미등록 키를 추가한 PR과 등록 Flag 호출을 지운 PR은 검사 실패로 스캔 기록에 남는다', async ({ page, request }) => {
    const base = gh.addRepo(FULL, 'main', { 'packages/adas/src/a.ts': "export const a = (c) => c.getBooleanValue('care_00022_signal', false);\n", 'README.md': '# e2e\n' });
    const packages = [{ name: 'adas', path: 'packages/adas' }];
    const created = await request.post(`${API}/api/flag-code/repositories`, { headers: { ...hdr('coordinator'), 'Idempotency-Key': crypto.randomUUID() }, data: { repository: `https://github.com/${FULL}`, displayName: 'e2e 검사', mode: 'GITHUB_APP', packages, installationId: 77 } });
    expect(created.status(), await created.text()).toBe(201);
    const repoId = (await created.json()).repoId as string;
    const target = `${API}/api/flag-code/webhooks/github`;
    // ① 미등록 키
    gh.commit(FULL, 'feature/new-key', { 'packages/adas/src/a.ts': "export const a = (c) => c.getBooleanValue('care_00022_signal', false);\nexport const n = (c) => c.isEnabled('adas_99998_experiment');\n" });
    const r1 = await gh.webhook(target, 'pull_request', { action: 'opened', repository: { html_url: `https://github.com/${FULL}` }, pull_request: { number: 11, head: { sha: gh.head(FULL, 'feature/new-key'), ref: 'feature/new-key' }, base: { sha: base, ref: 'main' } } }, { secret: SECRET });
    expect(r1.status, JSON.stringify(r1.body)).toBe(202);
    expect(r1.body).toMatchObject({ conclusion: 'failure' });
    // ② 등록된 Flag의 마지막 호출 삭제
    gh.commit(FULL, 'feature/remove-call', { 'packages/adas/src/a.ts': 'export const a = () => false;\n' });
    const r2 = await gh.webhook(target, 'pull_request', { action: 'opened', repository: { html_url: `https://github.com/${FULL}` }, pull_request: { number: 12, head: { sha: gh.head(FULL, 'feature/remove-call'), ref: 'feature/remove-call' }, base: { sha: base, ref: 'main' } } }, { secret: SECRET });
    expect(r2.body).toMatchObject({ conclusion: 'failure' });
    const d2 = await get(request, `/api/flag-code/scans/${r2.body.scanId}`);
    expect(d2.scan.prCheck.findings.map((f: { code: string }) => f.code)).toContain('REGISTERED_CALL_REMOVED');
    expect(gh.checkRuns.filter((c) => c.repo === FULL).map((c) => c.conclusion)).toEqual(['failure', 'failure']);
    // 화면 — 스캔 기록에서 PR 검사 실패와 미등록 키
    await as(page, 'viewer');
    await open(page, `/integration/code-scans?repo=${repoId}`);
    const pr = page.getByRole('table', { name: '스캔 실행' }).getByRole('row').filter({ hasText: 'PR #11' });
    await expect(pr).toContainText('실패');
    await pr.click();
    const detail = page.getByTestId('scan-detail');
    await expect(detail).toContainText('미등록 키');
    await expect(detail).toContainText('adas_99998_experiment');
  });
});

test('5 수명 관리 — 기한 지난 제거 대상에서 제거 PR을 만들고 시연 병합하면 정상, Retirement 단계로 이어진다', async ({ page, request }) => {
  const flag = 'ivi_00017_enable_2';
  expect((await row(request, flag)).status).toBe('REMOVAL_DUE');
  await as(page, 'integrator');
  await open(page, '/flag-code/lifecycle');
  const table = page.getByRole('table', { name: '제거 대상' });
  const line = table.getByRole('row').filter({ hasText: flag });
  await expect(line).toContainText(/기한 \d+일 지남/);
  await line.getByRole('button', { name: '제거 PR 만들기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '제거 PR 만들기' }).click();
  await expect(line.getByRole('button', { name: '시연 병합' })).toBeVisible();
  await line.getByRole('button', { name: '시연 병합' }).click();
  await expect.poll(async () => (await row(request, flag)).status).toBe('OK');
  await expect(table.getByRole('row').filter({ hasText: flag })).toHaveCount(0);
  await expect(page.getByRole('table', { name: '제거 PR' })).toContainText(flag);
  await page.getByRole('link', { name: 'Flag Retirement 단계 →' }).click();
  await expect(page).toHaveURL(/\/flag-retirements$/);
  await expect(page.getByText('RET-00001').first()).toBeVisible();
});

test('6 운영 — 서명 오류 폴백 급증 Flag를 고르면 시계열이 보이고 지도로 이어진다', async ({ page }) => {
  await as(page, 'operator');
  await open(page, '/ops/flag-evaluations');
  await expect(page.locator('[data-key-message]')).toContainText('기본값 폴백이 늘었습니다');
  const pick = page.getByRole('button', { name: /adas_00004_param 시계열 보기/ });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('flag-eval-trend')).toBeVisible();
  await expect(page.getByRole('list', { name: 'adas_00004_param 폴백 이유' })).toContainText('서명 오류');
  await page.getByRole('link', { name: '적용 차량 지도 →' }).click();
  await expect(page).toHaveURL(/\/fleet\/map\?lens=activation&flagKey=adas_00004_param/);
});

test('7 저장소 관리 — 구현 담당은 이유와 함께 막히고, 출시 담당의 스캔 주기 변경은 사유 필수·감사 기록', async ({ page, browser, request }) => {
  await as(page, 'integrator');
  await open(page, '/integration/code-repositories/FREPO-001');
  await expect(page.getByRole('button', { name: '설정 변경' })).toBeDisabled();
  await expect(page.getByText(/Feature 출시 담당자만 바꿉니다/)).toBeVisible();
  const ctx = await browser.newContext();
  const rm = await ctx.newPage();
  await as(rm, 'coordinator');
  await open(rm, '/integration/code-repositories/FREPO-001');
  await rm.getByRole('button', { name: '설정 변경' }).click();
  const drawer = rm.getByRole('dialog');
  await drawer.getByLabel('주기 재스캔(분)').fill('120');
  await expect(drawer.getByRole('button', { name: '변경 저장' })).toBeDisabled();
  await expect(drawer).toContainText('변경 사유를 두 글자 이상 쓰세요');
  await drawer.getByLabel(/변경 사유/).fill('야간 배포 창에 맞춰 두 시간 주기 — e2e');
  await drawer.getByRole('button', { name: '변경 저장' }).click();
  await expect(rm.getByRole('dialog')).toHaveCount(0);
  await expect(rm.locator('#settings-h').locator('xpath=ancestor::section[1]')).toContainText('2시간마다');
  await ctx.close();
  const audit = await get(request, '/api/audit?target=FREPO-001&action=FLAG_REPO_UPDATE');
  const items = (audit.items ?? audit) as { action: string; reason?: string; detail?: { reason?: string } }[];
  expect(JSON.stringify(items)).toContain('야간 배포 창에 맞춰 두 시간 주기');
});
