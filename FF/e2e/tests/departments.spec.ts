// 부서 보기(데모, 2026-11-04) — 부서를 고르면 메뉴·홈·배치·강조색이 화면 유형별로 바뀐다(기획 스튜디오·심사 결재함·
// 엔지니어링 콘솔·관제실·검토 포털). 전체 보기는 MENU 2.0(8그룹) 그대로다.
//   ① 화면 유형 표식(html[data-workspace]·홈 data-workspace-home) ② 부서 메뉴만, 8그룹 레일 없음 ③ 핵심 메시지 1개·첫 화면 위쪽·가장 큰 글자
//   ④ 본문 가로 넘침 없음 ⑤ axe wcag22aa serious·critical 0 (light·dark) ⑥ 유형마다 강조색이 다르다
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const CASES = [
  { dept: 'DEP-PDP', role: 'author', ws: 'studio', name: '상품기획팀' },
  { dept: 'DEP-FS', role: 'quality', ws: 'review', name: '기능안전팀' },
  { dept: 'DEP-INT', role: 'coordinator', ws: 'console', name: 'SW통합·릴리스팀' },
  { dept: 'DEP-OPS', role: 'operator', ws: 'control', name: 'OTA·서비스운영팀' },
  { dept: 'DEP-LEG', role: 'viewer', ws: 'portal', name: '법무팀' },
] as const;

async function open(page: Page, c: (typeof CASES)[number], width: number, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((s) => localStorage.setItem('fp.state.v2', JSON.stringify(s)), { role: c.role, department: c.dept, theme });
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
  await page.goto('/');
  await expect(page.locator(`#main [data-workspace-home="${c.ws}"]`)).toBeVisible();
  await page.waitForFunction(() => document.querySelector('#main [data-key-message] .ds-key__value')?.textContent?.trim() !== '—', null, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);
}

for (const c of CASES) {
  for (const width of [1366, 1920]) {
    test(`부서 보기 ${c.name} → ${c.ws} @${width}`, async ({ page }) => {
      await open(page, c, width);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-workspace'))).toBe(c.ws);
      await expect(page.getByRole('navigation', { name: `${c.name} 메뉴` })).toBeVisible();
      await expect(page.locator('.sh-rail')).toHaveCount(0);

      const key = page.locator('#main [data-key-message]');
      await expect(key, '핵심 메시지는 정확히 1개').toHaveCount(1);
      expect((await key.boundingBox())!.y, '핵심 메시지는 첫 화면 위쪽').toBeLessThan(c.ws === 'studio' || c.ws === 'portal' ? 380 : 320);
      const sizes = await page.evaluate(() => {
        const px = (e: Element) => parseFloat(getComputedStyle(e).fontSize);
        const k = document.querySelector('#main [data-key-message]')!;
        const keyMax = Math.max(...[k, ...k.querySelectorAll('*')].map(px));
        let other = 0;
        for (const e of document.querySelectorAll('#main *')) {
          if (k.contains(e) || e.closest('svg, canvas, [aria-hidden="true"]')) continue;
          if (![...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
          const r = (e as HTMLElement).getBoundingClientRect();
          if (r.width && r.height) other = Math.max(other, px(e));
        }
        return { keyMax, other };
      });
      expect(sizes.keyMax, '핵심 메시지가 화면에서 가장 큰 글자').toBeGreaterThan(sizes.other);
      const overflow = await page.evaluate(() => {
        const m = document.querySelector('#main') as HTMLElement;
        return m.scrollWidth - m.clientWidth;
      });
      expect(overflow, '본문 가로 넘침 없음').toBeLessThanOrEqual(1);
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`부서 보기 ${c.name} 접근성 (${theme})`, async ({ page }) => {
      await open(page, c, 1366, theme);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
}

test('부서 보기 — 화면 유형마다 강조색이 다르다', async ({ page }) => {
  const seen = new Set<string>();
  for (const c of CASES) {
    await open(page, c, 1366);
    seen.add(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()));
  }
  expect(seen.size).toBe(CASES.length);
});

test('부서 보기 — 상단 바로 부서를 바꾸고, 전체 메뉴 보기로 8그룹에 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.locator('.sh-rail')).toBeVisible();
  await page.getByRole('combobox', { name: '담당 부서' }).selectOption('DEP-OPS');
  await expect(page.locator('#main [data-workspace-home="control"]')).toBeVisible();
  await page.getByRole('navigation', { name: 'OTA·서비스운영팀 메뉴' }).getByRole('link', { name: 'Fleet 실시간 적용 현황' }).click();
  await expect(page).toHaveURL(/\/fleet\/live/);
  await page.getByRole('button', { name: '전체 메뉴 보기' }).click();
  await expect(page.locator('.sh-rail__btn:not(.sh-rail__toggle)')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-workspace'))).toBe(false);
});

test.describe('로그인에서 부서 고르기', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('담당 부서를 고르고 로그인하면 그 부서 작업공간으로 들어간다', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/login');
    await page.getByLabel('ID').fill('FF');
    await page.getByLabel('Password').fill('platform');
    await page.getByRole('combobox', { name: '담당 부서' }).selectOption('DEP-PDP');
    await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#main [data-workspace-home="studio"]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '상품기획팀 메뉴' })).toBeVisible();
  });
});
