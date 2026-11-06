// Flag에서 차량 지도로 이어지는 실제 조회. 타일만 차단하고 WebGL 차량 렌더링·서버 상태는 그대로 검증한다.
import { expect, test, type Page } from '@playwright/test';
import { sweepChecks } from './layout-measure';
import { settle } from './settle';

test.use({ viewport: { width: 1366, height: 900 }, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, reducedMotion: 'reduce' });
const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const SHOWCASE = process.env.E2E_SHOWCASE === '1';
const FLAG = 'care_00022_signal';
const MAP_URL = `/fleet/map?lens=activation&flagKey=${FLAG}`;
const ACT: Record<string, string> = { ON: '--ok', OFF: '--faint', DISABLED: '--danger', UNKNOWN: '--warn' };
type Vehicle = { vin: string; country: string; activation: string | null; position: { precision: string } | null };

test.beforeEach(async ({ page }) => {
  await page.route((url) => url.hostname === 'tiles.openfreemap.org', (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator', department: 'ALL' })));
});

async function mapReady(page: Page) {
  const canvas = page.getByTestId('fleet-map-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.fm-map')).toHaveAttribute('data-phase', 'ready');
  await expect(canvas.locator('canvas.maplibregl-canvas')).toBeVisible();
  // 세계 축척에서는 가까운 차량이 군집(data-grouped)으로 그려진다
  await expect.poll(async () => Number(await canvas.getAttribute('data-cars')) + Number((await canvas.getAttribute('data-grouped')) ?? 0)).toBeGreaterThan(0);
  return canvas;
}

async function mapResponse(page: Page, action: () => Promise<unknown>, key = FLAG) {
  const response = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return u.pathname === '/api/fleet/map' && u.searchParams.get('source') === 'FLEET' && u.searchParams.get('flagKey') === key && r.status() === 200;
  });
  await action();
  return (await response).json();
}

function stateCount(items: Vehicle[], state: string) { return items.filter(v => v.activation === state).length; }
async function legendCount(page: Page, label: string) {
  const row = page.getByRole('list', { name: '범례' }).locator('li').filter({ has: page.getByText(label, { exact: true }) });
  return Number((await row.locator('.fm-legend__n').getAttribute('title'))?.replace(/,/g, ''));
}

test('운영 담당자 — Flag 카드·정책에서 선택한 Flag 지도로 이동하고 URL·차량 선택이 복원된다', async ({ page }) => {
  await page.goto('/features/FEAT-00022/1.0.0?tab=flags');
  const card = page.locator('.ff-card').filter({ has: page.getByRole('heading', { name: FLAG, exact: true }) });
  const link = card.getByRole('link', { name: 'Flag 적용 차량 지도 →' });
  await expect(link).toHaveAttribute('href', MAP_URL);
  const data = await mapResponse(page, () => link.click());
  await expect(page).toHaveURL(new RegExp(`/fleet/map\\?lens=activation&flagKey=${FLAG}$`));
  await expect(page.getByRole('radio', { name: '기능 활성', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: '플래그' })).toHaveValue(FLAG);
  await mapReady(page);
  expect(await legendCount(page, '활성')).toBe(stateCount(data.items, 'ON'));
  const vin = 'KMH-NX4-0001';
  await page.getByRole('table', { name: '차량 목록' }).getByText(vin, { exact: true }).click();
  await expect(page.getByTestId('fleet-map-detail')).toBeVisible();
  await page.reload();
  await mapReady(page);
  await expect(page.getByRole('combobox', { name: '플래그' })).toHaveValue(FLAG);
  expect(new URL(page.url()).searchParams.get('vin')).toBe(vin);
  await page.getByRole('combobox', { name: '플래그' }).selectOption('care_00022_param');
  expect(new URL(page.url()).searchParams.get('vin')).toBe(vin);
  await page.goBack();
  await expect(page.getByRole('combobox', { name: '플래그' })).toHaveValue(FLAG);
  await page.goForward();
  await expect(page.getByRole('combobox', { name: '플래그' })).toHaveValue('care_00022_param');
  expect(new URL(page.url()).searchParams.get('vin')).toBe(vin);
  await page.goto('/policies/POL-00001');
  await expect(page.getByRole('link', { name: 'Flag 적용 차량 지도 →', exact: true })).toHaveAttribute('href', MAP_URL);
});

test('아직 배포하지 않은 Flag는 선택 이름을 유지하고 서버의 미확인·차단을 활성으로 표시하지 않는다', async ({ page }) => {
  const key = 'ivi_00027_voice';
  const data = await mapResponse(page, () => page.goto(`/fleet/map?lens=activation&flagKey=${key}`), key);
  await mapReady(page);
  await expect(page.getByRole('combobox', { name: '플래그' })).toHaveValue(key);
  await expect(page.getByRole('option', { name: /ivi_00027_voice · 조회 대상/ })).toBeAttached();
  await expect(page.getByTestId('map-requested-flag')).toContainText('현재 차량 수신 키 목록에 없는 조회 대상');
  expect(data.items.length).toBeGreaterThan(0);
  expect(stateCount(data.items, 'ON')).toBe(0);
  expect(await legendCount(page, '활성')).toBe(0);
  for (const present of [false, true]) {
    await page.evaluate(value => localStorage.setItem('ff.present', value ? '1' : '0'), present);
    await page.reload();
    await mapReady(page);
    const geometry = await sweepChecks(page);
    expect(geometry.overflow, `미배포 Flag 안내 ${present ? '시연' : '일반'}`).toBe(0);
    expect(geometry.overlaps).toEqual([]);
  }
});

test('등록 차량·여러 국가·실제 수신 상태가 WebGL 자동차 색과 범례에 반영된다', async ({ page, request }, testInfo) => {
  const headers = { 'X-Actor-Id': 'usr-operator', 'X-Actor-Role': 'OPERATOR' };
  await expect.poll(async () => {
    const r = await request.get(`${API}/api/fleet/map?source=FLEET&flagKey=${FLAG}`, { headers });
    expect(r.status(), await r.text()).toBe(200);
    const body = await r.json();
    return { n: body.items.length, on: stateCount(body.items, 'ON') > 0, off: stateCount(body.items, 'OFF') > 0 };
  }, { timeout: 30_000 }).toEqual({ n: SHOWCASE ? 240 : 12, on: true, off: true });
  const data = await mapResponse(page, () => page.goto(MAP_URL));
  expect(new Set(data.items.map((v: Vehicle) => v.country)).size).toBeGreaterThanOrEqual(3);
  const canvas = await mapReady(page);
  const expectedCars = data.items.filter((v: Vehicle) => v.position && v.position.precision !== 'REGION').length;
  await expect.poll(async () => Number(await canvas.getAttribute('data-cars')) + Number((await canvas.getAttribute('data-grouped')) ?? 0)).toBe(expectedCars);
  const points = JSON.parse((await canvas.getAttribute('data-points')) ?? '[]') as { vin: string; icon: string }[];
  // 군집 안 차량은 고리 색(상태별 대수)으로 — 자동차로 그린 차량만 아이콘 색을 본다
  expect(points.length + Number((await canvas.getAttribute('data-grouped')) ?? 0)).toBeGreaterThan(0);
  for (const point of points) {
    const item = data.items.find((v: Vehicle) => v.vin === point.vin);
    expect(point.icon, point.vin).toBe(`car${ACT[item.activation]}`);
  }
  expect(await legendCount(page, '활성')).toBe(stateCount(data.items, 'ON'));
  expect(await legendCount(page, '미확인(오프라인·판단 불일치)')).toBe(stateCount(data.items, 'UNKNOWN'));
  const screenshot = testInfo.outputPath('showcase-flag-map-webgl.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('실제 WebGL 차량 지도', { path: screenshot, contentType: 'image/png' });
  const synthetic = await request.get(`${API}/api/fleet/map?source=SYNTHETIC`, { headers });
  expect(synthetic.status(), await synthetic.text()).toBe(200);
  const profileMap = await synthetic.json();
  expect(profileMap.pointsOmitted + profileMap.items.length).toBeGreaterThan(1000);
  expect(profileMap.clusters.length).toBeGreaterThan(0);
  expect(profileMap.summary.length).toBeGreaterThan(0);
  for (const country of profileMap.summary) expect(Object.values(country.activation)).toEqual([0, 0, 0, 0]);
  expect(profileMap.items.every((v: Vehicle) => v.activation === null)).toBe(true);
});

for (const size of [
  ...[1024, 1280, 1366, 1536, 1920].map(width => ({ width, present: false })),
  ...[1366, 1920].map(width => ({ width, present: true })),
]) test(`Flag 지도 배치 @${size.width}${size.present ? ' 시연' : ''} — 실제 지도·범례·필터`, async ({ page }) => {
  await page.setViewportSize({ width: size.width, height: size.width >= 1920 ? 1080 : 800 });
  await page.goto('/_design');
  await page.evaluate(present => localStorage.setItem('ff.present', present ? '1' : '0'), size.present);
  await page.goto(MAP_URL);
  await mapReady(page);
  await settle(page);
  const result = await sweepChecks(page);
  expect(result.overflow, result.wide.join(', ')).toBe(0);
  for (const key of ['overlaps', 'kv', 'rows', 'numHead'] as const) expect(result[key], key).toEqual([]);
});
