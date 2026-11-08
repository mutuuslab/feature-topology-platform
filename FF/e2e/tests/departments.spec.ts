// 부서 보기(데모, 2026-11-04) — 부서를 고르면 메뉴·홈·배치·강조색이 화면 유형별로 바뀐다(기획 스튜디오·표준 검토함·
// 엔지니어링 검토·배포 및 모니터링·SW개발비 및 정보보안). 전체 보기는 MENU 2.0(10그룹) 그대로다.
//   ① 화면 유형 표식(html[data-workspace]·홈 data-workspace-home) ② 부서 메뉴만, 10그룹 레일 없음 ③ 핵심 메시지 1개·첫 화면 위쪽·가장 큰 글자
//   ④ 본문 가로 넘침 없음 ⑤ axe wcag22aa serious·critical 0 (light·dark) ⑥ 유형마다 강조색이 다르다
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { settle } from './settle';

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
  // 핵심 메시지 값은 데이터가 오기 전 '—' — 판정이 난 뒤를 본다(값이 없는 문장형 메시지면 기다리지 않는다)
  await expect(page.locator('#main [data-key-message] .ds-key__value').filter({ hasText: /^—$/ }), '핵심 메시지가 판정 보류(—)에서 멈췄다').toHaveCount(0, { timeout: 15_000 });
  await settle(page);
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

test('부서 보기 — 상단 바로 부서를 바꾸고, 전체 메뉴 보기로 10그룹에 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.locator('.sh-rail')).toBeVisible();
  await page.getByRole('combobox', { name: '담당 부서' }).selectOption('DEP-OPS');
  await expect(page.locator('#main [data-workspace-home="control"]')).toBeVisible();
  await page.getByRole('navigation', { name: 'OTA·서비스운영팀 메뉴' }).getByRole('link', { name: 'Fleet 실시간 적용 현황' }).click();
  await expect(page).toHaveURL(/\/fleet\/live/);
  await page.getByRole('button', { name: '전체 메뉴 보기' }).click();
  await expect(page.locator('.sh-rail__btn:not(.sh-rail__toggle)')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-workspace'))).toBe(false);
});

test.describe('로그인에서 부서 고르기', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('담당 부서를 고르고 로그인하면 그 부서 작업공간으로 들어간다', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/login');
    await page.getByLabel('ID').fill('FF');
    await page.getByLabel('Password').fill('FF');
    await page.getByRole('combobox', { name: '담당 부서' }).selectOption('DEP-PDP');
    await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#main [data-workspace-home="studio"]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '상품기획팀 메뉴' })).toBeVisible();
  });
});

// Feature DB는 엔지니어링 검토 부서(PLM·기준정보 승인·발행, 시스템엔지니어링 검토)가 맡는다 — 조밀한 행(--row-h 30px)에서도
// Feature DB 화면이 접근성 규칙을 지키고, 콘솔 홈에 변경 요청 대기열이 핵심 메시지 하나를 지킨 채 보인다(하네스 리뷰 F9·D1, 2026-11-04)
test.describe('콘솔 작업공간의 Feature DB', () => {
  const PLM = { dept: 'DEP-PLM', role: 'steward', ws: 'console', name: 'PLM·기준정보팀' } as const;

  test('콘솔 홈 — 변경 요청 대기열(검토 대기·발행 대기), 핵심 메시지는 하나', async ({ page }) => {
    await open(page, PLM as unknown as (typeof CASES)[number], 1366);
    const panel = page.getByRole('region', { name: 'Feature DB 변경 요청' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-tab="OPEN"] .ws-fdb__n')).toHaveText(/^\d+$/);
    await expect(page.locator('#main [data-key-message]')).toHaveCount(1);
  });

  for (const [url, label] of [
    ['/master/feature-db', 'Feature DB 목록'],
    ['/master/feature-db/changes', 'Feature DB 변경 요청'],
    ['/master/feature-db/CH-BRK-009', '기준 행 상세'],
  ] as const) {
    test(`콘솔(${PLM.name}) ${label} 접근성`, async ({ page }) => {
      await page.addInitScript((s) => localStorage.setItem('fp.state.v2', JSON.stringify(s)), { role: PLM.role, department: PLM.dept, theme: 'light' });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(url);
      await expect(page.locator('#main h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-workspace'))).toBe('console');
      await settle(page);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
