// 전세계 차량 지도(/fleet/map) 품질 하네스 — 실제 브라우저(WebGL·SwiftShader)에서 지도가 그린 결과를 검사한다.
// 외부 타일 서버는 막는다(CI 결정성) → 내장 육지 윤곽으로 대체되어야 한다. 검사:
//   ① 데모 차량 전부가 자동차 아이콘으로 그려지고 아이콘이 그 차량의 상태 색이다(구독·기능 활성 보기 모두) ② 지도 위 자동차를 누르면 그 차량 상세가 열린다
//   ③ 도시 단위로 확대하면 합성 차량도 자동차가 된다 ④ 범례 수 = 표 수 ⑤ 콘솔 오류·타일 밖 외부 요청 없음
// 상태 색 기대값은 화면 코드와 따로 적은 기준(구독: 제안·체험·구매 = 체험권 전환 화면 단계 색, 활성: 신호 색)이다.
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

const SUB: Record<string, string> = { OFFERED: '--viz-1', TRIAL: '--viz-2', PAID: '--viz-3', ENDED: '--faint', NONE: '--muted' };
const ACT: Record<string, string> = { ON: '--ok', OFF: '--faint', DISABLED: '--danger', UNKNOWN: '--warn' };

interface Item {
  vin: string;
  source: string;
  subscription: string;
  activation: string | null;
  position: { precision: string } | null;
}
interface Point {
  vin: string;
  icon: string;
  x: number;
  y: number;
}

/** 지도가 멈출 때까지(그린 자동차 수가 1.5초 동안 그대로) 기다린 뒤 진단 속성을 읽는다 */
async function settled(canvas: Locator) {
  let last: string | null = null;
  let same = 0;
  for (let i = 0; i < 60 && same < 3; i++) {
    await canvas.page().waitForTimeout(500);
    const now = `${await canvas.getAttribute('data-cars')}|${await canvas.getAttribute('data-rendered')}`;
    same = now === last && !now.startsWith('null') ? same + 1 : 0;
    last = now;
  }
  return {
    cars: Number(await canvas.getAttribute('data-cars')),
    rendered: Number(await canvas.getAttribute('data-rendered')),
    style: await canvas.getAttribute('data-style'),
    points: JSON.parse((await canvas.getAttribute('data-points')) ?? '[]') as Point[],
  };
}

/** 화면이 받은 데모 지도 응답 — 5초 갱신과 경합하지 않게 최근 둘을 기준으로 본다 */
function captureDemo(page: Page) {
  const got: Item[][] = [];
  page.on('response', async (r: Response) => {
    if (/\/api\/fleet\/map\?.*source=DEMO/.test(r.url()) && r.ok()) got.push(((await r.json()) as { items: Item[] }).items);
  });
  return () => got.slice(-2);
}

function watch(page: Page) {
  const errors: string[] = [];
  const external = new Set<string>();
  // 일부러 막은 타일 요청의 실패 기록은 오류가 아니다 — 메시지가 아니라 발생 위치로 거른다
  page.on('console', (m) => m.type() === 'error' && !/openfreemap/.test(`${m.location().url} ${m.text()}`) && errors.push(`${m.text()} @ ${m.location().url}`));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const h = new URL(r.url()).hostname;
    if (h !== 'localhost' && h !== '127.0.0.1') external.add(h);
  });
  return { errors, external };
}

test.beforeEach(async ({ page }) => {
  await page.route(/openfreemap\.org/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' })));
});

const located = (xs: Item[]) => xs.filter((v) => v.position && v.position.precision !== 'REGION');
const expectIcons = (points: Point[], responses: Item[][], vars: (v: Item) => string) => {
  for (const p of points) {
    const want = responses.map((xs) => xs.find((v) => v.vin === p.vin)).filter(Boolean).map((v) => `car${vars(v!)}`);
    expect(want, `${p.vin}: 아이콘 ${p.icon} ∉ 상태 색 ${want.join('/')}`).toContain(p.icon);
  }
};

test('데모 차량 전부가 자동차 아이콘 — 상태 색, 기능 활성 보기 전환, 기본 윤곽 대체, 오류·외부 요청 없음', async ({ page }) => {
  const w = watch(page);
  const demo = captureDemo(page);
  await page.goto('/fleet/map');
  const canvas = page.getByTestId('fleet-map-canvas');
  await canvas.waitFor();
  const s = await settled(canvas);
  expect(s.style).toBe('fallback');
  await expect(page.getByText(/기본 윤곽 지도/)).toBeVisible();
  const items = demo()[demo().length - 1];
  // 전세계 보기 — 위치가 있는 데모 차량은 모두 화면 안 자동차다
  expect(s.points.map((p) => p.vin).sort()).toEqual(located(items).map((v) => v.vin).sort());
  expect(s.cars).toBe(located(items).length);
  expectIcons(s.points, demo(), (v) => SUB[v.subscription]);
  // 범례 수 = 표 수
  const legend = page.getByRole('list', { name: '범례' });
  const table = page.getByRole('table', { name: '차량 목록' });
  const paidLegend = Number((await legend.locator('li', { hasText: '구독·구매' }).locator('.fm-legend__n').innerText()).replace(/,/g, ''));
  expect(paidLegend).toBe(await table.locator('tbody tr', { hasText: '구독·구매' }).count());

  await page.getByRole('radio', { name: '기능 활성' }).click();
  const a = await settled(canvas);
  expectIcons(a.points, demo(), (v) => ACT[v.activation!]);
  expect(w.errors, w.errors.join('\n')).toEqual([]);
  expect([...w.external].filter((h) => h !== 'tiles.openfreemap.org')).toEqual([]);
});

test('지도 위 자동차를 누르면 그 차량 상세(정밀 위치)가 열린다', async ({ page }) => {
  await page.goto('/fleet/map');
  const canvas = page.getByTestId('fleet-map-canvas');
  await canvas.waitFor();
  await page.getByRole('radio', { name: '한국' }).click();
  const { points } = await settled(canvas);
  // 다른 자동차와 30px 넘게 떨어진 자동차를 고른다(겹친 아이콘은 위에 그린 쪽이 잡힌다)
  const lone = points.find((p) => points.every((q) => q === p || Math.hypot(p.x - q.x, p.y - q.y) > 30));
  expect(lone, '떨어져 있는 자동차가 없다').toBeTruthy();
  await canvas.click({ position: { x: lone!.x, y: lone!.y } });
  await expect(page).toHaveURL(new RegExp(`vin=${encodeURIComponent(lone!.vin)}`));
  const detail = page.getByTestId('fleet-map-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText(lone!.vin)).toBeVisible();
  await expect(detail.getByText('정밀 위치 열람은 매번 감사에 남습니다.')).toBeVisible();
});

test('도시 단위로 확대하면 합성 차량도 자동차로 그린다(서울 도심 차량 선택)', async ({ page }) => {
  await page.goto('/fleet/map');
  const canvas = page.getByTestId('fleet-map-canvas');
  await canvas.waitFor();
  await page.getByRole('radio', { name: '시연 + 대상 차량(가중 표본)' }).click();
  await page.getByRole('radio', { name: '한국' }).click();
  const before = await settled(canvas);
  expect(before.rendered).toBeGreaterThan(before.cars); // 국가 단위 — 합성은 점
  // 서울 도심 차량을 고르면 지도가 그 차량으로 11단계(SELECT_ZOOM)까지 확대한다 — 합성 차량이 많은 도시라 결정적
  await page.getByRole('table', { name: '차량 목록' }).getByText('ego-01').click();
  await settled(canvas);
  expect(Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThanOrEqual(10.3);
  const after = await settled(canvas);
  expect(after.cars - after.points.length, '확대해도 합성 차량이 자동차로 바뀌지 않는다').toBeGreaterThan(0);
});

test('표에서 차량을 고르면 지도가 그 차량으로 옮겨 가운데에 자동차가 보인다', async ({ page }) => {
  await page.goto('/fleet/map');
  const canvas = page.getByTestId('fleet-map-canvas');
  await canvas.waitFor();
  await settled(canvas);
  await page.getByRole('table', { name: '차량 목록' }).getByText('KMH-NX4-0001').click();
  await expect(page.getByTestId('fleet-map-detail')).toBeVisible();
  const { points } = await settled(canvas);
  const box = (await canvas.boundingBox())!;
  const p = points.find((x) => x.vin === 'KMH-NX4-0001');
  expect(p, '고른 차량이 지도에 없다').toBeTruthy();
  expect(Math.hypot(p!.x - box.width / 2, p!.y - box.height / 2), '고른 차량이 지도 가운데가 아니다').toBeLessThan(40);
});
