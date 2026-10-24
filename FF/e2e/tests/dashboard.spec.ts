// 내 대시보드 — Jira(Atlassian) 대시보드를 실제 브라우저·백엔드(/api/dashboards)에서:
//   편집 모드 진입(시스템 대시보드 → 내 사본) → 가젯 추가·구성 → 끌어 옮기기 → 완료하면 손잡이 없음 → 새로 고침 뒤에도 그대로
//   → 역할에 공유 → 다른 역할이 '나와 공유된 대시보드'에서 연다. 키보드 이동(끌기 대안)·레이아웃 넘침도 본다.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const columns = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.jd-col')].map((c) => [...c.querySelectorAll(':scope > [data-gadget]')].map((g) => g.getAttribute('data-gadget'))));

async function asRole(page: Page, role: string) {
  await page.goto('/_design');
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
  await page.goto('/');
  await expect(page.locator('#main .jd')).toBeVisible();
}

async function edit(page: Page) {
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await expect(page.getByRole('region', { name: '대시보드 편집 중' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
});

test('편집 → 가젯 추가·구성 → 끌기 → 보기 모드(손잡이 없음) → 새로 고침 뒤 유지 → 역할 공유 → 다른 역할이 본다', async ({ page }) => {
  const name = `E2E 대시보드 ${Date.now()}`;
  await asRole(page, 'operator');
  // 처음은 역할의 시스템 대시보드 — 보기 모드에는 끌기 손잡이가 없다
  await expect(page.locator('#main h1')).toHaveText('내 대시보드');
  await expect(page.locator('.jd-grip')).toHaveCount(0);
  await expect(page.locator('.jd-gadget__head[draggable="true"]')).toHaveCount(0);

  // 편집 — 시스템 대시보드는 바꿀 수 없어 내 사본을 서버에 만들고 연다
  await edit(page);
  await expect(page.locator('#main h1')).toHaveText('내 대시보드 사본');
  await expect(page.locator('.jd-grip').first()).toBeVisible();
  const dir = page.getByRole('complementary', { name: '가젯 추가' });
  await expect(dir).toBeVisible();

  // 가젯 추가 → 가젯 안 구성 양식 → 저장
  await dir.getByPlaceholder('가젯 검색').fill('원형');
  await dir.getByRole('button', { name: '통계 원형 차트 추가' }).click();
  const form = page.getByRole('form', { name: '통계 원형 차트 구성' });
  await expect(form).toBeVisible();
  await form.getByLabel('데이터').selectOption('features');
  await form.getByLabel('통계 기준').selectOption('asil');
  await form.getByLabel('가젯 제목').fill('ASIL 비율');
  await form.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: 'ASIL 비율' })).toBeVisible();
  // 운영 시스템 판에도 원형 차트가 있다 — 방금 만든 가젯으로 좁힌다
  await expect(page.locator('[data-type="pie"]').filter({ has: page.getByRole('heading', { name: 'ASIL 비율' }) }).locator('.jd-legend')).toBeVisible();
  const pie = (await columns(page))[0][0]!;
  expect(pie).toMatch(/^pie-/);

  // 끌어 옮기기 — 오른쪽 열 맨 위(운영 요약)를 왼쪽 열 맨 위 가젯 위에 놓는다
  await page.locator('[data-gadget="summary"] .jd-gadget__head').dragTo(page.locator(`[data-gadget="${pie}"] .jd-gadget__head`), { targetPosition: { x: 60, y: 4 } });
  await expect.poll(async () => (await columns(page))[0][0]).toBe('summary');
  expect((await columns(page))[1]).not.toContain('summary');
  await expect(page.locator('.jd-drop')).toHaveCount(0);

  // 완료 — 보기 모드에는 손잡이·점선 열이 없다
  await page.getByRole('button', { name: '완료' }).click();
  await expect(page.locator('.jd')).toHaveAttribute('data-mode', 'view');
  await expect(page.locator('.jd-grip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '편집', exact: true })).toBeFocused();

  // 이름을 바꾸고(저장이 끝날 때까지) 새로 고침 — 서버에 저장된 판 그대로
  await page.getByRole('button', { name: '대시보드 더 보기' }).click();
  await page.getByRole('menuitem', { name: '이름 바꾸기' }).click();
  const rename = page.getByRole('dialog', { name: '이름 바꾸기' });
  await rename.getByLabel('이름').fill(name);
  await rename.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#main h1')).toHaveText(name);
  await expect(page.locator('.jd-meta')).not.toContainText('저장 중');
  await page.reload();
  await expect(page.locator('#main h1')).toHaveText(name);
  expect((await columns(page))[0].slice(0, 2)).toEqual(['summary', pie]);
  await expect(page.getByRole('heading', { name: 'ASIL 비율' })).toBeVisible();

  // 역할에 공유 — 조회 역할(운영·감사 조회자)
  await page.getByRole('button', { name: '대시보드 더 보기' }).click();
  await page.getByRole('menuitem', { name: '공유' }).click();
  const share = page.getByRole('dialog', { name: `'${name}' 공유` });
  await share.getByLabel('운영·감사 조회자').check();
  await share.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.jd-meta')).toContainText('공유: 운영·감사 조회자');
  await expect(page.locator('.jd-meta')).not.toContainText('저장 중');

  // 다른 역할 — '나와 공유된 대시보드'에서 열고, 볼 수만 있다(편집하면 사본)
  await asRole(page, 'viewer');
  await page.getByRole('button', { name: '대시보드 바꾸기' }).click();
  const group = page.getByRole('menu', { name: '대시보드 바꾸기' }).getByRole('group', { name: '나와 공유된 대시보드' });
  await group.getByRole('menuitemradio', { name: name }).click();
  await expect(page.locator('#main h1')).toHaveText(name);
  await expect(page.locator('.jd-meta')).toContainText('공유받음');
  expect((await columns(page))[0].slice(0, 2)).toEqual(['summary', pie]);
  await page.getByRole('button', { name: `${'ASIL 비율'} 가젯 메뉴` }).click();
  await expect(page.getByRole('menuitem', { name: '삭제' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('키보드 이동(끌기 대안) — 가젯 메뉴를 키보드로 열어 다른 열로 옮기고 알림을 읽어 준다', async ({ page }) => {
  await asRole(page, 'author');
  await edit(page);
  const menu = page.getByRole('button', { name: '바로 가기 가젯 메뉴' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: '바로 가기 가젯 메뉴' })).toBeVisible();
  await page.getByRole('menuitem', { name: '왼쪽 열로 이동' }).focus();
  await page.keyboard.press('Enter');
  expect((await columns(page))[0]).toContain('links');
  await expect(page.locator('.jd .ds-sr[aria-live="polite"]')).toContainText('바로 가기 — 1열');
  await page.getByRole('button', { name: '바로 가기 가젯 메뉴' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '바로 가기 가젯 메뉴' })).toBeFocused();
});

test('레이아웃 썸네일 — 3열은 세 열이 나란하고 가로 넘침이 없다', async ({ page }) => {
  await asRole(page, 'coordinator');
  await edit(page);
  await page.getByRole('radio', { name: '3열' }).click();
  const left = await page.evaluate(() => [...document.querySelectorAll('.jd-col')].map((c) => c.getBoundingClientRect().left));
  expect(left).toHaveLength(3);
  expect(left[0]).toBeLessThan(left[1]);
  expect(left[1]).toBeLessThan(left[2]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('접근성(axe, WCAG 2.2 AA) — 편집 모드(디렉터리·구성 양식)와 공유 창도 serious·critical 0', async ({ page }) => {
  const axe = async (where: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  };
  await asRole(page, 'quality');
  await edit(page);
  await page.getByRole('complementary', { name: '가젯 추가' }).getByRole('button', { name: '2차원 통계 추가' }).click();
  await expect(page.getByRole('form', { name: '2차원 통계 구성' })).toBeVisible();
  await axe('편집 모드');
  await page.getByRole('form', { name: '2차원 통계 구성' }).getByRole('button', { name: '저장' }).click();
  await page.getByRole('button', { name: '완료' }).click();
  await page.getByRole('button', { name: '대시보드 더 보기' }).click();
  await page.getByRole('menuitem', { name: '공유' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await axe('공유 창');
});
