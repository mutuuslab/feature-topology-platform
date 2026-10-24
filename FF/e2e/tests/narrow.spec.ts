// readiness: RD-P2-03 — 좁은 폭 스모크. tablet(768×1024, 보기·조작)·mobile(390×844, 보기만) 프로젝트가 이 파일을 돈다(playwright.config.ts).
// 확인: 페이지 가로 넘침 없음(표·그림은 자기 상자 안에서 가로 스크롤) · 메뉴에 닿을 수 있음 · 본문 제목·글자가 읽힌다(화면 안·보조 글자 11px 이상).
// 업무 절차 흐름도(/procedures/*)는 다른 작업이 다시 꾸미는 중이라 CSS를 고치지 않는다 — 넘침은 기록만(annotation, 20-92 문서).
import { expect, test, type Page } from '@playwright/test';

async function asRole(page: Page, role: string) {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem('e2e.role')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
      localStorage.removeItem('ff.learn.v1');
      sessionStorage.setItem('e2e.role', '1');
    }
  }, role);
}

/** 페이지 가로 넘침 — 넘친다면 화면 밖으로 나간 요소(가장 바깥 것 몇 개)를 함께 돌려준다(실패 메시지가 고칠 곳을 가리키게) */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const over = document.documentElement.scrollWidth - vw;
    if (over <= 1) return { over: 0, culprits: [] as string[] };
    const culprits: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      // 가로 스크롤 상자 안의 내용은 넘침이 아니다
      let p = el.parentElement;
      let clipped = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX) && p.getBoundingClientRect().right <= vw + 1) {
          clipped = true;
          break;
        }
        p = p.parentElement;
      }
      if (clipped) continue;
      culprits.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} right=${Math.round(r.right)}`);
      if (culprits.length >= 6) break;
    }
    return { over, culprits };
  });

/** 본문 제목이 화면 안에 있는지와 본문 글자 크기의 최솟값 */
const readable = (page: Page) =>
  page.evaluate(() => {
    const h = document.querySelector<HTMLElement>('#main h1, #main h2');
    const r = h?.getBoundingClientRect();
    const sizes = [...document.querySelectorAll<HTMLElement>('#main p, #main td, #main li, #main label, #main button')]
      .filter((e) => e.offsetParent !== null && (e.textContent ?? '').trim().length > 1)
      .slice(0, 200)
      .map((e) => parseFloat(getComputedStyle(e).fontSize));
    return { heading: !!h && !!r && r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1, minFont: sizes.length ? Math.min(...sizes) : null };
  });

const SCREENS = [
  { path: '/', title: '대시보드', role: 'operator' },
  { path: '/features', title: 'Feature 목록', role: 'author' },
  { path: '/features/FEAT-00022/1.0.0', title: 'Feature 상세', role: 'author' },
  { path: '/ops/kill', title: '긴급 차단', role: 'operator' },
  { path: '/fleet/vehicles', title: '차량', role: 'operator' },
];

for (const s of SCREENS) {
  test(`${s.title} — 가로 넘침 없음·제목과 글자가 읽힌다`, async ({ page }) => {
    await asRole(page, s.role);
    await page.goto(s.path);
    await expect(page.locator('#main h1, #main h2').first()).toBeVisible();
    await expect(page.locator('#main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    const o = await overflow(page);
    expect(o.over, `가로 넘침 ${o.over}px — ${o.culprits.join(' · ')}`).toBe(0);
    const r = await readable(page);
    expect(r.heading, '본문 제목이 화면 안에 있다').toBe(true);
    // 글자 하한은 데스크톱과 같은 디자인 규칙(보조 글자 11px, layout-quality.spec ④) — 좁은 폭에서 더 줄지 않는다
    if (r.minFont !== null) expect(r.minFont).toBeGreaterThanOrEqual(11);
  });
}

test('메뉴 — 좁은 폭에서도 메뉴를 열어 다른 화면으로 갈 수 있다', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: /Feature Platform|플랫폼/ }).first();
  await expect(rail).toBeVisible();
  // 레일의 첫 그룹을 눌러 메뉴 패널을 열고, 그 안의 첫 링크로 이동한다
  const groupBtn = rail.locator('.sh-rail__btn').first();
  await groupBtn.click();
  const link = page.locator('.sh-panel__list a').first();
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width + 1, '메뉴 링크가 화면 안에 있다').toBe(true);
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('#main h1, #main h2').first()).toBeVisible();
});

test('업무 절차 흐름도 — 넘침은 기록만(다른 작업이 화면을 고치는 중)', async ({ page }, info) => {
  await asRole(page, 'author');
  await page.goto('/procedures/FPW.1');
  await expect(page.getByRole('group', { name: 'FPW.1 흐름도' })).toBeVisible();
  const o = await overflow(page);
  // 흐름도 상자 자체의 가로 스크롤(넓은 스윔레인을 좁은 폭에서 밀어 보는지)도 기록한다
  const inner = await page.getByRole('group', { name: 'FPW.1 흐름도' }).evaluate((el) => {
    let e: HTMLElement | null = el as HTMLElement;
    while (e && e.scrollWidth <= e.clientWidth + 1 && e.id !== 'main') e = e.parentElement;
    return e ? { scroll: e.scrollWidth, client: e.clientWidth, box: e.id || e.className.toString().split(' ')[0] } : null;
  });
  const page_ = o.over ? `페이지 가로 넘침 ${o.over}px — ${o.culprits.join(' · ')}` : '페이지 넘침 없음';
  const box = inner && inner.scroll > inner.client + 1 ? `흐름도는 ${inner.box} 안에서 가로 스크롤(${inner.scroll}/${inner.client}px)` : '흐름도 가로 스크롤 없음';
  info.annotations.push({ type: 'narrow-finding', description: `/procedures/FPW.1 @${page.viewportSize()!.width}px: ${page_}, ${box}` });
});
