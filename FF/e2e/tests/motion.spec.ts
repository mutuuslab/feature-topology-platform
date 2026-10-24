// 모션 체계 v1(2026-10-24) — 장식 모션 대신 상태 변화에만 짧은 모션. tools/motion-rules.ts(정적)와 짝을 이루는 실행 검사.
//   ① 화면이 자리 잡은 뒤 본문(#main)에서 도는 무한 반복 애니메이션은 harness/motion.json loops에 있는 것만
//   ② 움직임 줄이기(prefers-reduced-motion)면 커널이 html[data-motion=calm]을 달고, 문서 전체에 도는 애니메이션이 없다
//   ③ 상태 변화 모션(2단계): 실시간 값이 바뀐 칸만 한 번 깜빡인다(data-changed, 첫 그림 제외). 움직임 줄이기면 표식만 남고 재생하지 않는다
// BDC 데모(/twin/*)는 별도 레거시 화면 묶음(래칫 motionLoopsLegacy), 디자인 갤러리(/_design)는 부품 견본이라 ①에서 뺀다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

const ALLOW = Object.keys((JSON.parse(readFileSync(join(__dirname, '..', '..', 'harness', 'motion.json'), 'utf8')) as { loops: Record<string, string> }).loops);
const SKIP = (u: string) => u.startsWith('/twin') || u.startsWith('/_design');

async function settle(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('#main').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"], #main .ds-skel'), null, { timeout: 10_000 }).catch(() => {});
}

/** 본문에서 도는 무한 반복 애니메이션 이름 */
const mainLoops = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('#main');
    return [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
          .filter((a) => {
            const t = (a.effect as KeyframeEffect | null)?.target;
            return !!t && !!main && main.contains(t);
          })
          .map((a) => (a as CSSAnimation).animationName ?? '(script)'),
      ),
    ];
  });

for (const s of [...MENU_ENTRIES.map((m) => m.menu), ...DRILLDOWNS.map((d) => d.url)].filter((u) => !SKIP(u))) {
  test(`모션 ①: ${s} — 본문 무한 반복은 허용 목록만`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await settle(page, s);
    const loops = await mainLoops(page);
    expect(loops.filter((n) => !ALLOW.includes(n)), `허용 목록(harness/motion.json) 밖 무한 반복: ${loops.join(', ')}`).toEqual([]);
  });
}

for (const url of ['/', '/fleet/live', '/ops/kill', '/features', '/login']) {
  test(`모션 ②: ${url} — 움직임 줄이기면 도는 애니메이션이 없다`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await settle(page, url);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'calm');
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? '(script)'),
    );
    expect(running, `움직임 줄이기인데 도는 애니메이션: ${running.join(', ')}`).toEqual([]);
  });
}

// ③ 상태 변화 모션 — 실시간 회신으로 칸 값이 바뀌면 그 칸만 한 번 깜빡인다(data-changed). 첫 그림·같은 값 새로 고침에는 표식이 없다.
// 결정적으로 만들기: 실제 차량 회신은 다른 시험(긴급 차단 등)과 병렬로 섞이므로 쓰지 않는다.
//   SSE(/api/events/stream)를 vehicle.* 이벤트 하나로 대신하고(retry 300ms → 다시 연결할 때마다 같은 이벤트 → 화면이 Fleet 조회를 새로 고친다),
//   Fleet 조회(/api/fleet/runtime)는 실제 응답을 받되, arm() 뒤의 조회부터 값을 받은 첫 차량의 첫 flag 값을 번갈아 뒤집는다.
async function driveFleetChanges(page: Page) {
  const event = { seq: 1, id: 'e2e-motion', type: 'vehicle.e2e', at: new Date().toISOString(), aggregate: 'e2e', componentId: null, payload: {} };
  await page.route('**/api/events/stream', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: `retry: 300
event: platform
data: ${JSON.stringify(event)}

` }),
  );
  let armed = false;
  let flips = 0;
  let calls = 0;
  await page.route('**/api/fleet/runtime*', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { items: { flags: { local: { value: boolean; reason: string } }[] }[] };
    calls++;
    // 차량 측 값을 받은(미수신이 아닌) 첫 차량 — 병렬 시험이 차량을 더해도 대상이 사라지지 않는다
    const f = body.items.find((r) => r.flags.length > 0)?.flags[0];
    if (armed && f && ++flips % 2 === 1) f.local = { value: !f.local.value, reason: f.local.reason === 'KILL_SWITCH' ? 'DEFAULT' : f.local.reason };
    await route.fulfill({ response: res, json: body });
  });
  return { arm: () => void (armed = true), calls: () => calls };
}

const changedCells = (page: Page) => page.locator('#main .ds-fleet [data-changed]');

test('모션 ③: /fleet/live — 첫 그림·같은 값 새로 고침에는 표식이 없고, 실시간 회신으로 값이 바뀐 칸만 한 번 깜빡인다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const drive = await driveFleetChanges(page);
  await page.goto('/fleet/live');
  await expect(page.locator('#main .ds-fleet .ds-fcell').first()).toBeVisible();
  // 이벤트로 같은 값을 여러 번 다시 받아도(조회 3회 이상) 표식이 없다 — 첫 그림·첫 값은 강조하지 않는다
  await expect.poll(drive.calls, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await expect(changedCells(page)).toHaveCount(0);
  await expect(page.locator('[data-key-message]')).not.toHaveAttribute('data-changed', /.+/);
  drive.arm();
  await expect(changedCells(page).first()).toBeVisible({ timeout: 10_000 });
  // 깜빡임은 한 번 재생(무한 반복 아님), 시간은 토큰 기반(0보다 길다)
  const flash = await page.waitForFunction(
    () => {
      const a = document.getAnimations().find((x) => /^ds-flash-[ab]$/.test((x as CSSAnimation).animationName ?? '') && x.playState === 'running');
      return a ? { iterations: a.effect!.getTiming().iterations, duration: Number(a.effect!.getTiming().duration) } : null;
    },
    null,
    { timeout: 10_000 },
  );
  const t = await flash.jsonValue();
  expect(t!.iterations).toBe(1);
  expect(t!.duration).toBeGreaterThan(0);
});

test('모션 ③: /fleet/live — 움직임 줄이기면 표식은 붙어도 깜빡임은 재생되지 않는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1366, height: 768 });
  const drive = await driveFleetChanges(page);
  drive.arm();
  await page.goto('/fleet/live');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'calm');
  await expect(changedCells(page).first()).toBeVisible({ timeout: 10_000 });
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName ?? '(script)'));
  expect(running, `움직임 줄이기인데 도는 애니메이션: ${running.join(', ')}`).toEqual([]);
});
