// 담당자 시나리오(W1 — 운영관제·긴급 차단, persona-findings P3-2·P4-1~P4-4·P4-6~P4-10) — 실제 백엔드(메모리 DB·v0.81, 실제 타이머)와 화면으로 1366폭에서:
//   운영자 요청 → 기능안전(FSM, 기능안전 부서)·사이버보안(CSM, 사이버보안 부서 — 같은 사람이 FSM도 가진 시스템 연계 담당) 승인, 역할이 그대로 기록
//   → 시뮬레이터 차량 회신 CONFIRMED(배포·차량 상세가 채워짐) → 복원 전망(두 번째 Safety Manager·운영 리더)
//   → 재검증 Evidence·Canary Cohort로 단계적 복원(차단 승인자 막힘, safety2·opslead 승인) → 감사(조회)가 사후 검토.
import { expect, test, type Page } from '@playwright/test';
import { lockKill, releaseKillLocks } from './kill-lock';

test.use({ viewport: { width: 1366, height: 768 } });

async function as(page: Page, role: string, department?: string) {
  await page.evaluate(
    ([r, d]) => {
      const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
      s.role = r;
      s.department = d ?? 'ALL';
      localStorage.setItem('fp.state.v2', JSON.stringify(s));
    },
    [role, department ?? null] as const,
  );
}

/** 서랍 안에서 서랍 밖으로 넘친 요소 — 1366에서 잘림 없음(P4-10) */
async function drawerOverflow(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('.ds-drawer');
    if (!d) return ['no drawer'];
    const box = d.getBoundingClientRect();
    return [...d.querySelectorAll('*')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        // 가로 스크롤 상자(표 감싸개) 안의 셀은 넘쳐도 상자가 스크롤한다 — 상자 자체만 본다
        if (e.closest('.ds-table-wrap') && !e.classList.contains('ds-table-wrap')) return false;
        return r.width > 0 && r.right > box.right + 1;
      })
      .map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(' ')[0]}:${(e.textContent ?? '').trim().slice(0, 30)} (right ${Math.round(e.getBoundingClientRect().right)} > ${Math.round(box.right)})`)
      .slice(0, 5);
  });
}

test.afterEach(releaseKillLocks);

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await page.goto('/_design');
});

test('배포 및 모니터링 — 긴급 차단 FSM+CSM(역할 기록) → 차량 회신 → 단계적 복원(재검증 Evidence·Cohort, safety2·opslead) → 감사 사후 검토', async ({ page }) => {
  test.setTimeout(300_000); // 아래 기다림(다른 시험의 차단이 끝날 때까지)을 포함
  await lockKill(page.request, 'FEAT-00022'); // 같은 Feature를 차단하는 ops.spec·learn.spec과 차례를 둔다
  // ── 1. 운영자 요청(OTA·서비스운영) ──
  await as(page, 'operator', 'DEP-OPS');
  await page.goto('/ops/kill');
  await page.getByRole('button', { name: '긴급 차단 요청' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText('care_00022_param, care_00022_signal')).toBeVisible();
  for (const box of await form.getByRole('group', { name: '대상 차량' }).getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').textContent()) ?? '';
    if (!/ego-01|lead-01/.test(label)) await box.uncheck();
  }
  await form.getByLabel(/봉쇄 결정 근거/).fill('관제 시나리오 — 원인 분석 전 봉쇄');
  await form.getByLabel('사유', { exact: true }).fill('관제 시나리오 — 전방 거리 오추정');
  // 승인 안내 — 이 차단은 기능안전 + 사이버보안 2인(2026-11-04 결정)
  await expect(form.locator('.ds-rules__item[data-status="pending"]')).toContainText('기능안전(Safety Manager) + 사이버보안 2인이 승인합니다');
  await form.getByRole('button', { name: '차단 요청', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('textbox').fill('FEAT-00022');
  await confirm.getByRole('button', { name: '차단 요청' }).click();
  let drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(/KILL-\d{5}/);
  const killId = ((await drawer.locator('h2').first().textContent()) ?? '').trim();
  await expect(drawer.locator('.ds-approvals__slot .ds-approvals__role')).toHaveText(['기능안전(Safety Manager)', '사이버보안']);
  // 지금 승인할 수 있는 사람 — 운영 리더는 이 차단의 승인자가 아니다
  const who = drawer.getByTestId('approver-candidates');
  await expect(who).toContainText('오세린(기능안전 담당)');
  await expect(who).not.toContainText('강태윤');

  // ── 2. 기능안전(품질 검토, 기능안전 부서) → FSM ──
  await as(page, 'quality', 'DEP-FS');
  await page.goto(`/ops/kill?id=${killId}`);
  drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(drawer.locator('.ds-approvals__slot[data-done]')).toHaveCount(1);
  await expect(drawer.locator('.ds-approvals__slot[data-done] .ds-approvals__role')).toHaveText(['기능안전(Safety Manager)']);

  // ── 3. 시스템 연계(FSM·CSM 겸유) — 사이버보안 부서에서 승인하면 CSM. 두 번째 FSM으로 서명할 수 없다(P3-2) ──
  await as(page, 'integrator', 'DEP-CS');
  await page.goto(`/ops/kill?id=${killId}`);
  drawer = page.getByRole('dialog');
  await expect(drawer.getByText('남은 칸은 사이버보안(CSM)만', { exact: false })).toHaveCount(0);
  // 남은 필수 역할은 CSM 하나 — 선택 상자 없이 CSM으로, 복원할 Safety Manager(safety2)가 남으니 막힘 경고 없음(P4-1)
  await expect(drawer.getByTestId('restore-dead-end')).toHaveCount(0);
  await drawer.getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(drawer.locator('.ds-approvals__slot[data-done]')).toHaveCount(2);
  await expect(drawer.locator('.ds-approvals__slot[data-done] .ds-approvals__role')).toHaveText(['기능안전(Safety Manager)', '사이버보안']);
  const kill = await (await page.request.get(`/api/kill-requests/${killId}`)).json();
  expect(kill.approvals.map((a: { approverId: string; role: string; platformRole: string }) => [a.approverId, a.role, a.platformRole])).toEqual([
    ['usr-quality', 'FSM', 'SAFETY_OFFICER'],
    ['usr-integrator', 'CSM', 'SECURITY_OFFICER'],
  ]);

  // ── 4. 차량 회신 — 시뮬레이터 차량이 회신해 '적용 확인' 2/2(P4-3), 서랍은 1366에서 넘치지 않는다(P4-10) ──
  await expect(drawer.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '2', { timeout: 30_000 });
  await expect(drawer).toContainText('적용 확인');
  await expect(drawer).not.toContainText('DISPATCHED');
  await expect(drawer.getByTestId('kill-timeline').locator('tbody tr')).toHaveCount(2);
  await expect(drawer.getByTestId('restore-evidence')).toBeVisible();
  expect(await drawerOverflow(page)).toEqual([]);

  // 배포 화면 — 차단 게시본이 회신 대기에 머물지 않고, 표는 1366에서 열이 잘리지 않는다(P4-4)
  await page.goto('/deployments');
  const killRow = page.getByRole('row', { name: /차단/ }).first();
  await expect(killRow).toContainText('적용 확인');
  const clip = await page.evaluate(() => {
    const w = document.querySelector('main .ds-table-wrap') as HTMLElement | null;
    return w ? w.scrollWidth - w.clientWidth : -1;
  });
  expect(clip).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('replies-paused')).toHaveCount(0);
  // 차량 상세 — 차단 상태가 채워지고 '판단 불가'가 아니다
  await page.goto('/fleet/vehicles/ego-01?tab=records'); // 정책 게시본·수신 기록 탭(ADS-UI01 차량 화면 탭 분할)
  await expect(page.locator('[data-key-message]')).not.toContainText('판단 불가');
  await expect(page.getByText(/FEAT-00022 긴급 차단/)).toBeVisible({ timeout: 20_000 });

  // ── 5. 복원 — 운영자: 재검증 Evidence·Canary Cohort(ego-01)로 1단계(P4-7) ──
  await as(page, 'operator', 'DEP-OPS');
  await page.goto(`/ops/kill?id=${killId}`);
  drawer = page.getByRole('dialog');
  const outlook = drawer.getByTestId('restore-outlook');
  await expect(outlook).toContainText('오세린(기능안전 담당)');
  await expect(outlook).toContainText('강태윤(운영 리더)');
  const rf = drawer.getByTestId('restore-form');
  await rf.getByLabel('사유', { exact: true }).fill('원인 수정·재검증 완료');
  await expect(rf.getByTestId('restore-evidence')).toBeVisible();
  await expect(rf.getByRole('checkbox', { name: 'ego-01' })).toBeChecked();
  await expect(rf.getByRole('checkbox', { name: 'lead-01' })).not.toBeChecked();
  // 확인 항목을 체크하지 않으면 요청 버튼이 막혀 있다
  await expect(rf.getByRole('button', { name: '복원 요청' })).toBeDisabled();
  for (const c of ['차단 사유 해소', '원인 조치 완료']) await rf.getByRole('checkbox', { name: c }).check(); // 해제 확인 항목(FR-KSW-004-002)
  await rf.getByRole('button', { name: '복원 요청' }).click();
  await expect(drawer).toContainText('재검증');

  // 차단 승인자(품질 검토)는 복원을 승인할 수 없다
  await as(page, 'quality', 'DEP-FS');
  await page.goto(`/ops/kill?id=${killId}`);
  await expect(page.getByRole('dialog')).toContainText('직전 차단 승인자는 복원을 승인할 수 없습니다');
  // 두 번째 Safety Manager(safety2) → FSM, 운영 리더(opslead) → OPS_LEAD
  for (const [role, dept] of [
    ['safety2', 'DEP-FS'],
    ['opslead', 'DEP-OPS'],
  ] as const) {
    await as(page, role, dept);
    await page.goto(`/ops/kill?id=${killId}`);
    drawer = page.getByRole('dialog');
    await drawer.locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
    if (role === 'safety2') await expect(drawer.locator('[data-tour="kill-restore"] .ds-approvals__slot[data-done]')).toHaveCount(1);
  }
  drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('차단 중 · 복원 1/2대');
  await expect(drawer.getByRole('table', { name: '단계적 복원 기록' })).toContainText('ego-01');
  const stageVin = drawer.getByRole('table', { name: '단계적 복원 기록' }).getByText('ego-01', { exact: true });
  expect(await stageVin.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  })).toBe(1);

  // 2단계 — 남은 차량(lead-01), 끝나면 해제
  await as(page, 'operator', 'DEP-OPS');
  await page.goto(`/ops/kill?id=${killId}`);
  const rf2 = page.getByRole('dialog').getByTestId('restore-form');
  await rf2.getByLabel('사유', { exact: true }).fill('Canary 관측 이상 없음 — 확대');
  await expect(rf2.getByRole('checkbox', { name: 'lead-01' })).toBeChecked();
  for (const c of ['차단 사유 해소', '원인 조치 완료']) await rf2.getByRole('checkbox', { name: c }).check(); // 해제 확인 항목(FR-KSW-004-002)
  await rf2.getByRole('button', { name: '복원 요청' }).click();
  for (const [role, dept] of [
    ['safety2', 'DEP-FS'],
    ['opslead', 'DEP-OPS'],
  ] as const) {
    await as(page, role, dept);
    await page.goto(`/ops/kill?id=${killId}`);
    await page.getByRole('dialog').locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
  }
  drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('해제됨');
  const restored = await (await page.request.get(`/api/kill-requests/${killId}`)).json();
  expect(restored).toMatchObject({ status: 'RELEASED', restoredVins: ['ego-01', 'lead-01'] });
  expect(restored.restoreStages).toHaveLength(2);

  // ── 6. 사후 검토 — 승인자는 이유와 함께 막히고, 감사(조회)가 기록한다(P4-2) ──
  await as(page, 'quality', 'DEP-FS');
  await page.goto(`/ops/kill?id=${killId}`);
  await expect(page.getByRole('dialog').getByTestId('post-review-blocked')).toHaveText('승인자는 자기가 승인한 명령을 사후 검토할 수 없습니다');
  await as(page, 'viewer', 'DEP-QA');
  await page.goto(`/ops/kill?id=${killId}`);
  const pr = page.getByRole('dialog').getByTestId('post-review');
  await pr.getByRole('textbox').fill('발령 사유·범위·2인 승인 역할(FSM+CSM)·단계적 복원 적정 확인');
  await pr.getByRole('button', { name: '사후 검토 기록' }).click();
  await expect(page.getByRole('dialog')).toContainText('발령 사유·범위·2인 승인 역할');
  await expect(page.getByRole('dialog')).toContainText('최지훈');
  await expect(page.getByRole('dialog')).not.toContainText(/usr-viewer|AUDITOR/);
  const reviews = await (await page.request.get('/api/kill-post-reviews')).json();
  expect(reviews.items.find((r: { killId: string }) => r.killId === killId)).toMatchObject({ status: 'REVIEWED', review: { reviewer: 'usr-viewer', role: 'AUDITOR' } });
});

test('운행 중 감시 지표 — 데모 배포 Version의 경보 기준이 기록돼 있어 "예시값으로 판정 중"이 아니다(P4-12)', async ({ page }) => {
  await as(page, 'operator', 'DEP-OPS');
  await page.goto('/ops/safety-kpi');
  await expect(page.locator('[data-key-message]')).toBeVisible();
  await expect(page.locator('[data-key-message]')).not.toContainText('예시값');
});

test('보안·인증서 — 용도를 골라 키 교체, 은퇴 키는 검증 전용, HSM·승인자 키는 업무 이름(P4-6)', async ({ page }) => {
  await as(page, 'integrator', 'DEP-CS');
  await page.goto('/admin/security');
  const box = page.getByTestId('key-rotate');
  await box.getByLabel('키 용도').selectOption('gate');
  await box.getByLabel('사유', { exact: true }).fill('관제 시나리오 정기 교체');
  await box.getByRole('button', { name: '서명 키 교체' }).click();
  await expect(box).toContainText('교체했습니다');
  await expect(page.getByText('검증 전용').first()).toBeVisible();
  await expect(page.getByText('등록된 승인자 공개키')).toBeVisible();
  await expect(page.locator('#sec-hsm-h').locator('..')).not.toContainText('approverKeys');
  // 교체 알림 — 품질 담당(Safety Manager)에게
  await as(page, 'quality', 'DEP-FS');
  const n = await (await page.request.get('/api/notifications', { headers: { 'X-Actor-Id': 'usr-quality', 'X-Actor-Role': 'SAFETY_OFFICER' } })).json();
  expect(n.items.some((x: { eventType: string; title: string }) => x.eventType === 'pki.key.rotated' && x.title.includes('정책 게이트 판정'))).toBe(true);
});
