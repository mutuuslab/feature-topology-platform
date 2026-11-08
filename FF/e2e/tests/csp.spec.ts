// 배포 보안 헤더 — 출시 준비 RD-SEC-12. preview(verify의 e2e)는 public/_headers의 '/*' 묶음을 그대로 건다(frontend/vite.config.ts).
// readiness: RD-SEC-12
//   ① 문서 응답에 CSP·HSTS·X-Frame-Options·nosniff·Referrer-Policy가 있다
//   ② 모든 메뉴·하위 화면·로그인 화면에서 CSP 위반이 0건 — CSP를 좁혀도 화면이 깨지지 않는다
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

const PREVIEW = process.env.E2E_WEB === 'preview';

async function collect(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.effectiveDirective} ← ${e.blockedURI || '(inline)'}`));
  });
}

test('배포 헤더 ①: 문서 응답에 다섯 보안 헤더', async ({ page }) => {
  test.skip(!PREVIEW, '개발 서버는 배포 헤더를 걸지 않는다 — verify(E2E_WEB=preview)에서 확인');
  const res = await page.goto('/');
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBeTruthy();
});

for (const url of ['/login', ...MENU_ENTRIES.map((m) => m.menu), ...DRILLDOWNS.map((d) => d.url)]) {
  test(`배포 헤더 ②: ${url} — CSP 위반 0`, async ({ page, browser }) => {
    test.skip(!PREVIEW, '개발 서버는 배포 헤더를 걸지 않는다');
    const p = url === '/login' ? await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage() : page;
    await collect(p);
    await p.setViewportSize({ width: 1366, height: 768 });
    await p.goto(url);
    await expect(p.locator(url === '/login' ? 'form, main' : '#main').first()).toBeVisible();
    await p.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    const v = await p.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(v, `CSP 위반: ${v.join(' · ')}`).toEqual([]);
  });
}
