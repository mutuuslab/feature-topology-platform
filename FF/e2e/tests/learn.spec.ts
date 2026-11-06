// 표준 따라하기 — 허브 → CS-01 보기 모드(가이드 패널이 화면을 옮겨 다니며 대상을 강조하고 역할을 전환), 12개 시나리오 단계 대상, 직접 하기 대표 시나리오 2개.
// 레이아웃: 1366(떠 있는 패널)·1920(오른쪽 열)·시연 모드(아래 자막 띠)에서 가로 넘침이 없어야 한다.
import { expect, test, type Page } from '@playwright/test';
import { TUTORIALS } from '../../contracts/src/rules/tutorial';
import { lockKill, releaseKillLocks } from './kill-lock';

async function asRole(page: Page, role: string) {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem('e2e.role')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
      localStorage.removeItem('ff.learn.v1');
      sessionStorage.setItem('e2e.role', '1');
    }
  }, role);
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [w, h] of [[1366, 768], [1920, 1080]] as const) {
  test(`CS-01 보기 모드 ${w}: 시작 → 분류 화면 강조 → 가상검증 화면 → 역할 전환 → 끝내기`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await asRole(page, 'author');
    await page.goto('/learn');
    await page.getByRole('link', { name: /거리 추정 오류/ }).click();
    await page.getByRole('button', { name: '보기 모드로 시작' }).click();
    const dock = page.getByRole('complementary', { name: '따라하기 가이드' });
    await expect(dock.getByRole('heading', { level: 2 })).toHaveText('무엇을 확인하나');
    await expect(page.locator('[data-tour="learn-compare"][data-tour-active="true"]')).toBeVisible();
    await expect(page.locator('.sh-spot')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    await dock.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(/\/features\/FEAT-00022\/1\.0\.0\?tab=safety$/);
    await expect(page.locator('[data-tour="safety-tab"][data-tour-active="true"]')).toBeVisible();
    await expect(dock.getByText('대상 강조 중')).toBeVisible();

    await dock.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(/\/validations\/virtual$/);
    await expect(page.locator('[data-tour="sim-status"][data-tour-active="true"]')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    // 마지막 단계(G5)는 품질 검토 역할 — 배너 → 전환
    for (let i = 0; i < 4; i++) await dock.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(/tab=gates/);
    await expect(dock.getByText(/역할로 진행합니다/)).toBeVisible();
    await dock.getByRole('button', { name: '역할 전환' }).click();
    await expect(dock.getByText(/현재 역할이 맞습니다/)).toBeVisible();
    await expect(page).toHaveURL(/tab=gates/); // 역할 전환은 화면을 옮기지 않는다
    await expect(page.locator('[data-tour="gate-g5"][data-tour-active="true"]')).toBeVisible();

    await dock.getByRole('button', { name: '끝내기', exact: true }).click();
    await expect(page).toHaveURL(/\/learn\/CS-01$/);
    await expect(dock).toHaveCount(0);
  });
}

test('시연 모드: 가이드는 본문 아래 자막 띠 — 가로 넘침 없음, 접으면 버튼만', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => localStorage.setItem('ff.present', '1'));
  await asRole(page, 'author');
  await page.goto('/learn/CS-01');
  await page.getByRole('button', { name: '보기 모드로 시작' }).click();
  const dock = page.getByRole('complementary', { name: '따라하기 가이드' });
  const box = await dock.boundingBox();
  expect(box!.y).toBeGreaterThan(1080 / 2); // 아래쪽 띠
  expect(await noHorizontalOverflow(page)).toBe(true);
  await dock.getByRole('button', { name: '가이드 접기' }).click();
  await expect(page.getByRole('button', { name: '가이드 펼치기' })).toBeVisible();
});

test('표준 설명 모드: 켜면 화면 요소 옆 근거 칩이 보이고 누르면 보고서 원문', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/_design');
  await expect(page.locator('.ds-explain').first()).toBeHidden(); // 꺼져 있으면 접근성 트리에서도 빠진다
  const toggle = page.getByRole('button', { name: '근거 규칙 보기' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const chip = page.locator('.ds-explain').getByRole('button', { name: 'FFG-CLS-009 원문 요약 보기' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('dialog')).toContainText('ISO 26262-3:2018 cl.7');
});

// ── 12개 시나리오 — 보기 모드로 단계마다 실제 화면에서 대상을 찾는다(앵커·경로·시드 ID가 살아 있는지) ──
// 앞 단계가 만드는 화면(FEAT-00022 1.1.0)과, 진행 중인 차단이 있어야 열리는 복원 칸·최신 Version에만 있는 [새 Version]은 직접 하기 시험이 본다.
const STATEFUL = ['kill-restore', 'version-new'];
const dockOf = (page: Page) => page.getByRole('complementary', { name: '따라하기 가이드' });

for (const t of TUTORIALS) {
  test(`${t.id} 보기 모드: 모든 단계 화면에서 대상을 찾는다`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/_design');
    const made = new Set(t.steps.flatMap((s) => s.creates ?? []).map((c) => c.replace('@', '/')));
    for (const [i, s] of t.steps.entries()) {
      if (STATEFUL.includes(s.anchor) || [...made].some((m) => s.route.includes(m))) continue;
      await page.evaluate(
        ([id, step, role]) => {
          localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
          localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: id, step: Number(step), mode: 'view', startedAt: '2026-11-06T00:00:00Z' }));
        },
        [t.id, String(i), s.role],
      );
      await page.goto(s.route);
      const dock = dockOf(page);
      await expect(dock.getByRole('heading', { level: 2 }), `${t.id}/${s.id}`).toHaveText(s.title);
      await expect(dock.getByText(/대상 강조 중/), `${t.id}/${s.id} → ${s.anchor}`).toBeVisible({ timeout: 15_000 });
      await expect(dock.getByText(/역할로 진행합니다/)).toHaveCount(0);
    }
  });
}

// ── 직접 하기 — 대표 시나리오를 실제 서버에서 처음부터 끝까지. 다음 단계는 화면 결과 판정을 통과해야 열린다 ──
/** 가이드가 단계에 와 있고, 역할이 다르면 가이드의 [역할 전환]으로 바꾼다 */
async function atStep(page: Page, title: string) {
  const dock = dockOf(page);
  await expect(dock.getByRole('heading', { level: 2 })).toHaveText(title);
  const sw = dock.getByRole('button', { name: '역할 전환' });
  if (await sw.isVisible()) await sw.click();
  await expect(dock.getByText(/현재 역할이 맞습니다/)).toBeVisible();
  return dock;
}
/** 열린 서랍·확인 창을 닫는다 — 본문을 누르기 전에(가이드 열은 가림막 밖이라 서랍을 연 채로도 누를 수 있다) */
async function closeOverlays(page: Page) {
  for (let i = 0; i < 3 && (await page.locator('[aria-modal="true"]').count()); i++) await page.keyboard.press('Escape');
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
}
/** 판정 통과를 확인하고 다음 단계로 */
async function passAndNext(page: Page, last = false) {
  const dock = dockOf(page);
  await expect(dock.locator('[data-check="done"]')).toBeVisible({ timeout: 20_000 });
  await dock.getByRole('button', { name: last ? '끝내기' : '다음', exact: true }).click();
}

test.afterEach(releaseKillLocks);

test('KILL-DC2 직접 하기: 요청 → 요청자 승인 거부 → 2인 승인 → 차량 DC2 단계 → 복원(차단 승인자 거부) → 해제', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await asRole(page, 'operator');
  await page.goto('/learn/KILL-DC2');
  await page.getByRole('button', { name: '직접 하기' }).click();
  let dock = await atStep(page, '무엇을 확인하나');
  await dock.getByRole('button', { name: '다음' }).click();

  // 2 차량에서 일어나는 순서 — 판정 전에는 다음이 막혀 있다
  dock = await atStep(page, '차량에서 일어나는 순서 보기');
  await expect(page).toHaveURL(/\/ops\/kill$/);
  await expect(dock.getByRole('button', { name: '다음' })).toBeDisabled();
  await page.getByRole('button', { name: '긴급 차단 요청' }).click();
  let form = page.getByRole('dialog');
  await expect(form.getByLabel('차단 대상 Feature')).toHaveValue('FEAT-00022');
  await expect(form.getByText(/전방 안전거리/)).toBeVisible();
  await expect(form.locator('ol[aria-label="차량에서 일어나는 순서"] li[data-stage="RAMP"]')).toBeVisible();
  await passAndNext(page);

  // 3 차단 요청 — KMH-NX4-0004만. FEAT-00022는 긴급 차단 e2e(ops.spec)도 쓴다 — 작업자 사이 잠금을 잡고 요청한다(afterEach에서 푼다)
  await atStep(page, '차단 요청');
  await lockKill(page.request, 'FEAT-00022');
  await closeOverlays(page);
  await page.getByRole('button', { name: '긴급 차단 요청' }).click();
  form = page.getByRole('dialog');
  await expect(form.getByText('KMH-NX4-0004')).toBeVisible();
  for (const box of await form.getByRole('group', { name: '대상 차량' }).getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').textContent()) ?? '';
    if (!label.includes('KMH-NX4-0004')) await box.uncheck();
  }
  await form.getByLabel(/봉쇄 결정 근거/).fill('원인 분석 전 봉쇄');
  await form.getByLabel('사유', { exact: true }).fill('현장 거리 오추정 보고');
  await expect(form.locator('.ds-rules__item[data-status="fail"]')).toHaveCount(0);
  await form.getByRole('button', { name: '차단 요청', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('textbox').fill('FEAT-00022');
  await confirm.getByRole('button', { name: '차단 요청' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('승인 대기');
  const killId = ((await drawer.locator('h2').first().textContent()) ?? '').trim();
  expect(killId).toMatch(/^KILL-\d{5}$/);
  await passAndNext(page);

  const openKill = async () => {
    await closeOverlays(page);
    await page.getByRole('table', { name: '긴급 차단·복구' }).getByRole('row', { name: new RegExp(killId) }).click();
    await expect(page.getByRole('dialog')).toContainText(killId);
    return page.getByRole('dialog');
  };

  // 4 요청자는 승인할 수 없다 — 방금 만든 차단 기록이 열린 채라 판정이 바로 통과하고, 가이드 열은 가림막 밖이라 서랍을 닫지 않고 누른다
  await atStep(page, '요청자는 승인할 수 없다');
  await expect(page.getByRole('dialog').getByRole('button', { name: '승인 — 개인 서명' })).toBeDisabled();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
  await passAndNext(page);

  // 5·6 기능안전 → 사이버보안 승인 — 가이드의 역할 전환으로 사람을 바꾼다
  await atStep(page, '승인 1 — 기능안전');
  await (await openKill()).getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(page.getByRole('dialog').locator('.ds-approvals__slot[data-done]')).toHaveCount(1);
  await passAndNext(page);
  await atStep(page, '승인 2 — 사이버보안 → 명령 발행');
  await (await openKill()).getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(page.getByRole('dialog')).toContainText('차단 중');
  await passAndNext(page);

  // 7 차량 Guard의 DC2 단계 — 시뮬레이터가 경고 → 램프 → DISABLED를 보고한다
  await atStep(page, '차량의 DC2 단계');
  await expect(page).toHaveURL(/\/fleet\/vehicles\/KMH-NX4-0004$/);
  await expect(page.locator('[data-tour="vehicle-status-v2"]')).toContainText('DISABLED', { timeout: 20_000 });
  await passAndNext(page);

  // 8 복원 요청
  await atStep(page, '복원 요청');
  await expect(page).toHaveURL(/\/ops\/kill$/);
  let k = await openKill();
  await k.getByTestId('restore-form').getByLabel('사유', { exact: true }).fill('원인 수정 확인');
  await k.getByRole('button', { name: '복원 요청' }).click();
  await expect(k.locator('[data-tour="kill-restore"] ol.ds-approvals__slots')).toBeVisible();
  await passAndNext(page);

  // 9 차단 승인자(품질 검토)는 복원을 승인할 수 없다
  await atStep(page, '차단 승인자는 복원을 승인할 수 없다');
  await expect(await openKill()).toContainText('직전 차단 승인자는 복원을 승인할 수 없습니다');
  await passAndNext(page);

  // 10·11 다른 기능안전 담당 → 운영 리더
  await atStep(page, '복원 승인 1 — 다른 기능안전 담당');
  k = await openKill();
  await k.locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(k.locator('[data-tour="kill-restore"] .ds-approvals__slot[data-done]')).toHaveCount(1);
  await passAndNext(page);
  await atStep(page, '복원 승인 2 — 운영 리더 → 복구 전달');
  k = await openKill();
  await k.locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(k).toContainText('해제됨');
  await passAndNext(page, true);
  await expect(page).toHaveURL(/\/learn\/KILL-DC2$/);
  await expect(dockOf(page)).toHaveCount(0);
});

test('CS-07 직접 하기: 의무 기능·DC2 위반 → DC4·R2 저장 → 원격 차단 요청 거부 → 미확인 시장 활성화 차단 → 중국 조건', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await asRole(page, 'author');
  await page.goto('/learn/CS-07');
  await page.getByRole('button', { name: '직접 하기' }).click();
  let dock = await atStep(page, '무엇을 확인하나');
  await dock.getByRole('button', { name: '다음' }).click();

  // 2 법규 의무 기능인데 DC2 — 조합 검사 위반, 확정 막힘
  dock = await atStep(page, '법규 의무 기능인데 DC2라면');
  await expect(page).toHaveURL(/\/features\/FEAT-00015\/1\.2\.0\?tab=safety$/);
  await expect(dock.getByRole('button', { name: '다음' })).toBeDisabled();
  await page.getByText('추가 속성', { exact: true }).click();
  await page.getByLabel('법규 의무 기능(GSR)').check();
  await expect(page.locator('[data-rule="FFG-CLS-005"][data-status="fail"]')).toBeVisible();
  await passAndNext(page);

  // 3 DC4·R2로 고쳐 저장
  await atStep(page, 'DC4·R2로 고쳐 저장');
  await page.getByRole('combobox', { name: '비활성화 등급 DC', exact: true }).selectOption('DC4');
  await page.getByRole('combobox', { name: '법규 등급 R', exact: true }).selectOption('R2');
  await expect(page.locator('[data-rule="FFG-CLS-005"]')).toHaveCount(0);
  await page.getByRole('button', { name: '초안 저장' }).click();
  await expect(page.locator('[data-saved~="deactClass=DC4"]')).toBeVisible();
  await passAndNext(page);

  // 4 원격 차단 요청이 막힌다
  await atStep(page, '원격 차단 요청이 막힌다');
  await expect(page).toHaveURL(/\/ops\/kill$/);
  await page.getByRole('button', { name: '긴급 차단 요청' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('차단 대상 Feature').fill('FEAT-00015');
  await form.getByLabel('Version', { exact: true }).fill('1.2.0');
  await expect(form.locator('.ds-btn-why__text')).toContainText('DC4·법규 의무 기능은 원격 비활성화 대상이 아님');
  await expect(form.getByRole('button', { name: '차단 요청', exact: true })).toBeDisabled();
  await expect(form.locator('ol[aria-label="차량에서 일어나는 순서"]')).toHaveCount(0);
  await passAndNext(page);

  // 5 확인되지 않은 시장 — F2 이상 활성화 차단
  await atStep(page, '확인되지 않은 시장');
  await expect(page).toHaveURL(/\/verify\/compliance\?tab=profiles$/);
  await page.locator('[data-tour="cp-sim"]').getByLabel('시장').selectOption('OTHER');
  await expect(page.getByTestId('cp-verdict')).toContainText('Profile 없음');
  await passAndNext(page);

  // 6 중국 — 신고·허가 ID와 사용자 확인(보기)
  await atStep(page, '중국 — 신고·허가 ID와 사용자 확인');
  await expect(page.locator('[data-tour="cp-profiles"]').getByRole('row', { name: /^CN/ })).toContainText('신고·허가 ID 필수');
  await dockOf(page).getByRole('button', { name: '끝내기', exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/CS-07$/);
});
