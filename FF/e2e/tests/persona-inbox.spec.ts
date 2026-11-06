// 담당자 시나리오 W2(2026-11-05) — 검토함·홈·알림·사람 표시. 담당자마다 자기 대기열에서 항목을 보고 → 대상을 열고 → 처리하며, 다음 담당자에게 알림이 간다.
//   ① 정의 승인: Feature 설계가 제안(G1~G3 PASS) → 정의 승인자의 검토함 '정의 승인 대기'에 내 차례 → 상세 '다음 차례'가 "지금 정의 승인" → 승인
//   ② Baseline 확정 요청: 요청이 콘솔 홈(PLM)·검토함에 뜬다(PENDING 조회 — REQUESTED 0건 결함) → BOM 승인자에게 알림, 요청자는 이름으로
//   ③ Release Sign-off: G8·G9 PASS → 기획 스튜디오 'Release Sign-off 대기' → 상세에서 서명 → 출시 담당 알림·검토함 '출시 가능', 감사(조회)도 알림
//   ④ Feature DB 변경 요청: 도메인 검토자 검토함 'Feature DB 검토 대기' → 보완 의견 → 요청자 알림
//   ⑤ 결재함 부서 대기열: 시험·검증팀은 G5만, 기능안전팀은 긴급 차단이 맨 앞(기한 배지), 요청 시각이 빈 칸이 아니다
//   ⑥ 부서 전환: 역할이 바뀌면 알리고, 전체 보기로 돌아오면 원래 역할
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRefs, REF } from './refdb';
import { QUEUE_RANK } from '../../frontend/src/screens/home/queues';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const AUTHOR: [string, string] = ['usr-author', 'FEATURE_AUTHOR'];
const JUDGE: [string, string] = ['usr-quality', 'GATE_JUDGE'];

async function as(page: Page, role: string, department = 'ALL') {
  await page.evaluate(
    ([r, d]) => {
      const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
      s.role = r;
      s.department = d;
      localStorage.setItem('fp.state.v2', JSON.stringify(s));
    },
    [role, department],
  );
}

async function post(request: APIRequestContext, path: string, who: [string, string], data: unknown, code = 201) {
  const r = await request.post(`${API}${path}`, { headers: H(...who), data });
  expect(r.status(), await r.text()).toBe(code);
  return r.json();
}

const judge = (request: APIRequestContext, id: string, ver: string, gate: string) =>
  post(request, `/api/features/${id}/versions/${ver}/gates`, JUDGE, { gate, inputResult: 'PASS', rationale: 'W2 e2e 판정 근거', evidenceRef: `EV-W2-${gate}` });

const notes = async (request: APIRequestContext, who: [string, string]) => (await (await request.get(`${API}/api/notifications?limit=500`, { headers: H(...who) })).json()).items as { eventType: string; aggregate: string; link: string }[];

/** 제안 → G1 → 안전 분류 확정 → G2 → G3 */
async function proposeReady(request: APIRequestContext, name: string) {
  const f = await post(request, '/api/features', AUTHOR, { name, description: 'W2 e2e', requirementIds: ['REQ-E2E-W2'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'], ...apiRefs(REF.nightVision) });
  await judge(request, f.featureId, f.version, 'G1');
  await post(request, `/api/features/${f.featureId}/versions/${f.version}/safety/confirm`, ['usr-safety', 'SAFETY_OFFICER'], { reason: 'HARA 검토 완료' });
  // G2 PASS는 서명된 HARA가 있어야 한다(분석 근거)
  await post(request, `/api/features/${f.featureId}/versions/${f.version}/analysis/hara`, ['usr-safety', 'SAFETY_OFFICER'], { docId: 'HARA-W2-001', asil: 'QM', safetyGoals: [{ id: 'SG-01', text: '의도하지 않은 경고를 막는다', asil: 'QM' }], reason: 'HARA 검토' });
  await judge(request, f.featureId, f.version, 'G2');
  await judge(request, f.featureId, f.version, 'G3');
  return f as { featureId: string; version: string };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('① 정의 승인 대기 — 정의 승인자 검토함에 내 차례 → 상세 다음 차례 → 승인, 작성자 이름으로', async ({ page, request }) => {
  const name = `W2 정의 승인 ${uniq()}`;
  const f = await proposeReady(request, name);
  await as(page, 'approver');
  await page.goto('/admin/approval');
  const q = page.getByRole('region', { name: '정의 승인 대기' });
  const row = q.getByRole('row').filter({ hasText: `${f.featureId} ${f.version}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('김민영');
  await expect(q).not.toContainText(/usr-/);
  await row.getByRole('link', { name: '열기' }).click();
  await expect(page).toHaveURL(new RegExp(`/features/${f.featureId}/${f.version}`));
  const next = page.getByRole('region', { name: '다음 차례' });
  await expect(next).toContainText('지금 정의 승인할 수 있습니다');
  await expect(page.getByRole('button', { name: 'APPROVED로 전이' })).toBeEnabled();
  // 작성자에게는 같은 버튼이 막히고 이유가 보인다(서버가 행위자 역할로 미리 판정 — P2-4)
  await as(page, 'author');
  await page.reload();
  await expect(page.getByRole('button', { name: 'APPROVED로 전이' })).toBeDisabled();
  await expect(page.locator('.ds-btn-why').first()).toContainText('권한이 없습니다');
  await expect(page.getByRole('region', { name: '다음 차례' })).toContainText('내 차례가 아닙니다');
  // 승인(정의 승인자) → 대기열에서 빠진다
  await post(request, `/api/features/${f.featureId}/versions/${f.version}/transitions`, ['usr-approver', 'FEATURE_APPROVER'], { to: 'APPROVED', reason: '정의 승인' }, 200);
  await as(page, 'approver');
  await page.goto('/admin/approval');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '정의 승인 대기' }).getByText(`${f.featureId} ${f.version}`)).toHaveCount(0);
});

test('② Baseline 확정 요청 — PLM 콘솔 홈·검토함에 뜨고 BOM 승인자에게 알림', async ({ page, request }) => {
  const f = await proposeReady(request, `W2 Baseline ${uniq()}`);
  await post(request, `/api/features/${f.featureId}/versions/${f.version}/transitions`, ['usr-approver', 'FEATURE_APPROVER'], { to: 'APPROVED', reason: '정의 승인' }, 200);
  const r = await post(request, '/api/baselines/requests', AUTHOR, { featureId: f.featureId, version: f.version, reason: '확정 요청' });
  expect((await notes(request, ['usr-steward', 'BOM_APPROVER'])).some((n) => n.eventType === 'baseline.requested' && n.link === `/baselines?request=${r.requestId}`)).toBe(true);
  await as(page, 'steward', 'DEP-PLM');
  await page.goto('/');
  const panel = page.getByRole('table', { name: 'Baseline 확정 요청' });
  const row = panel.getByRole('row').filter({ hasText: r.requestId });
  await expect(row).toBeVisible();
  await expect(row).toContainText('김민영');
  await expect(page.locator('[data-key-message]')).not.toContainText('확정 대기 요청 없음');
  await page.goto('/admin/approval');
  await page.getByRole('region', { name: 'Baseline 확정 요청' }).getByRole('row').filter({ hasText: `${f.featureId} ${f.version}` }).getByRole('link', { name: '열기' }).click();
  await expect(page).toHaveURL(new RegExp(`request=${r.requestId}`));
});

test('③ Release Sign-off — 스튜디오 대기 목록 → 서명 → 출시 담당·감사 알림, 검토함 출시 가능', async ({ page, request }) => {
  const id = 'FEAT-00001';
  const ver = '2.2.0';
  await post(request, `/api/features/${id}/versions/${ver}/safety/confirm`, ['usr-safety', 'SAFETY_OFFICER'], { reason: 'HARA 검토 완료' }).catch(() => undefined);
  await judge(request, id, ver, 'G8');
  await judge(request, id, ver, 'G9');
  await as(page, 'author', 'DEP-PDP');
  await page.goto('/');
  const q = page.getByRole('region', { name: 'Release Sign-off 대기' });
  await expect(q).toBeVisible();
  await expect(page.locator('[data-key-message]')).toContainText('Release Sign-off 대기');
  await q.locator('li').filter({ hasText: `${id}@${ver}` }).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/features/${id}/${ver}`));
  await page.getByRole('button', { name: 'Release Sign-off — 개인 서명' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('[data-signoff-evidence] a')).toHaveCount(3);
  await drawer.locator('textarea[name="reason"]').fill('출시 책임 확인 — G8·G9·Safety Case 검토');
  await drawer.getByRole('button', { name: 'Release Sign-off — 개인 서명' }).click();
  await expect(drawer).toBeHidden();
  // 서명 표시 — 이름·한국 시각(계정 ID·UTC 없음)
  await expect(page.getByTestId('release-signoff')).toContainText('Release Sign-off 완료 — 김민영');
  await expect(page.getByTestId('release-signoff')).not.toContainText('usr-');
  expect((await notes(request, ['usr-coordinator', 'RELEASE_MANAGER'])).some((n) => n.eventType === 'release.signed' && n.link === `/features/${id}/${ver}`)).toBe(true);
  expect((await notes(request, ['usr-viewer', 'AUDITOR'])).some((n) => n.eventType === 'release.signed')).toBe(true);
  await as(page, 'coordinator');
  await page.goto('/admin/approval');
  const rel = page.getByRole('region', { name: '출시 가능' }).getByRole('row').filter({ hasText: `${id} ${ver}` });
  await expect(rel).toBeVisible();
  await expect(rel).toContainText('김민영');
  // 조회(감사) 계정 알림 화면이 비지 않는다
  await as(page, 'viewer');
  await page.goto('/notifications');
  await expect(page.getByTestId('notification-row').first()).toBeVisible();
});

test('④ Feature DB 변경 요청 — 도메인 검토자 대기열 → 보완 의견 → 요청자 알림', async ({ page, request }) => {
  // 진행 중인 변경 요청이 없는 활성 행 하나(같은 서버에서 다시 돌려도 409가 나지 않게)
  const open = new Set(((await (await request.get(`${API}/api/refdb/changes?status=REVIEW`, { headers: H(...AUTHOR) })).json()).items as { refId: string }[]).map((x) => x.refId));
  const refs = ((await (await request.get(`${API}/api/refdb/refs?status=ACTIVE&limit=50`)).json()).items as { refId: string }[]).map((x) => x.refId);
  const refId = refs.find((r) => !open.has(r)) ?? REF.weather;
  const c = await post(request, '/api/refdb/changes', AUTHOR, { kind: 'MODIFY', refId, after: { remark: `W2 e2e 별칭 ${uniq()}` }, reason: '검색 별칭 추가' });
  expect((await notes(request, ['usr-approver', 'DOMAIN_REVIEWER'])).some((n) => n.eventType === 'refdb.change.created' && n.aggregate === c.changeId)).toBe(true);
  await as(page, 'approver');
  await page.goto('/admin/approval');
  const row = page.getByRole('region', { name: 'Feature DB 검토 대기' }).getByRole('row').filter({ hasText: c.changeId });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: '열기' }).click();
  await expect(page).toHaveURL(new RegExp(`/master/feature-db/changes/${c.changeId}`));
  await post(request, `/api/refdb/changes/${c.changeId}/reviews`, ['usr-approver', 'DOMAIN_REVIEWER'], { opinion: 'REVISE', comment: '출처 근거 보완' });
  expect((await notes(request, AUTHOR)).some((n) => n.eventType === 'refdb.change.reviewed' && n.aggregate === c.changeId)).toBe(true);
});

test('⑤ 결재함 부서 대기열 — 시험·검증팀은 G5만, 요청 시각이 빈 칸이 아니다 · 기능안전팀은 급한 순서', async ({ page }) => {
  await as(page, 'quality', 'DEP-VAL');
  await page.goto('/');
  const list = page.locator('[data-queue-dept="DEP-VAL"]');
  await page.getByRole('radio', { name: /부서 전체/ }).click();
  await expect(list.locator('li').first()).toBeVisible();
  const queues = await list.locator('li').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-queue')));
  expect(new Set(queues)).toEqual(new Set(['gate']));
  await expect(list).not.toContainText(/\bG4\b|\bG6\b/);
  const since = await list.locator('.ws-queue__since').allTextContents();
  expect(since.length).toBeGreaterThan(0);
  expect(since.every((s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s))).toBe(true);
  await as(page, 'quality', 'DEP-FS');
  await page.goto('/');
  await page.getByRole('radio', { name: /부서 전체/ }).click();
  const fs = page.locator('[data-queue-dept="DEP-FS"] li');
  await expect(fs.first()).toBeVisible();
  const order = await fs.evaluateAll((ls) => ls.map((l) => l.getAttribute('data-queue')));
  // 급한 순서 = 화면의 대기열 순위(QUEUE_RANK) — 운영 점검 조치·모델 사용 승인(Data Lake, TL-UI13)도 같은 표로
  const idx = order.map((q) => QUEUE_RANK[q as keyof typeof QUEUE_RANK] ?? -1);
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
});

test('⑥ 부서 전환 — 역할이 바뀌면 알리고, 전체 보기로 돌아오면 원래 역할', async ({ page }) => {
  await as(page, 'operator');
  await page.goto('/');
  await page.getByRole('combobox', { name: '담당 부서' }).selectOption('DEP-DPO');
  await expect(page.getByText(/역할이 .* → .*\(으\)로 바뀌었습니다/)).toBeVisible();
  await page.getByRole('combobox', { name: '담당 부서' }).selectOption('ALL');
  await expect(page.getByText(/원래 역할 .*차량 운영/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fp.state.v2') || '{}').role)).toBe('operator');
});
