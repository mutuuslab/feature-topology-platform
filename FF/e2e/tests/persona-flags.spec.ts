// 구현 담당자가 실제 Git 스캔을 가져오고, Feature Flag → 코드 → 정책 → Unleash 근거를 따라간다.
// 예제 커밋은 이미 DEMO 시드에 있으므로 재가져오기는 같은 기록을 보존해야 한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { settle } from './settle';
import { sweepChecks } from './layout-measure';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const FEATURE = '/features/FEAT-00022/1.0.0';
const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'fixtures', 'demo', 'flag-sources.json'), 'utf8'));
const usage = fixture.usages.find((u: { flagKey: string }) => u.flagKey === 'care_00022_signal');
const sourceUrlOf = (u: { path: string; line: number }) => `${fixture.repository}/blob/${fixture.commit}/${u.path.split('/').map(encodeURIComponent).join('/')}#L${u.line}`;
const sourceUrl = sourceUrlOf(usage);
const distanceUsages = fixture.usages.filter((u: { flagKey: string }) => u.flagKey.startsWith('care_00022_'));
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

async function as(page: Page, role: string, present = false) {
  await page.evaluate(({ role, present }) => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role, department: 'ALL' }));
    localStorage.setItem('ff.present', present ? '1' : '0');
  }, { role, present });
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('#main')).toBeVisible();
  await settle(page);
}

async function noViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
}

async function noLayoutDefects(page: Page, state: string, scope = 'body') {
  const result = await sweepChecks(page, scope);
  expect(result.overflow, `${state}: ${result.wide.join(', ')}`).toBe(0);
  for (const name of ['overlaps', 'kv', 'rows', 'numHead'] as const) expect(result[name], `${state} ${name}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('구현 담당자 — 실제 Git 스캔 재가져오기 → 소스 파일·줄 → 정책·Unleash 연결', async ({ page, request }) => {
  await as(page, 'integrator');
  const before = await request.get(`${API}/api/flag-sources`);
  expect(before.status(), await before.text()).toBe(200);
  const prior = (await before.json()).find((r: any) => r.manifest.repository === fixture.repository && r.manifest.commit === fixture.commit);
  expect(prior, '예제 커밋의 실제 시드 기록').toBeTruthy();

  await open(page, FEATURE);
  const highlight = page.locator('.ff-highlight[aria-label="Feature Flag"]');
  await expect(highlight).toBeVisible();
  await expect(highlight).toContainText('care_00022_signal');
  await highlight.getByRole('link', { name: 'Flag 연결 보기 →' }).click();
  await expect(page.getByRole('tab', { name: 'Feature Flag', exact: true })).toHaveAttribute('aria-selected', 'true');
  const card = page.locator('.ff-card').filter({ has: page.getByRole('heading', { name: 'care_00022_signal', exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.locator('.ff-flow > li')).toHaveCount(5);
  await expect(card.locator('[data-flag-stage="evaluation"]')).toContainText('3 · Unleash 평가');
  await expect(card.locator('[data-flag-stage="delivery"]')).toContainText('4 · 차량 배포');
  await expect(card.locator('[data-flag-stage="receipt"]')).toContainText('5 · 차량으로부터 수신');
  await expect(card.getByRole('link', { name: `${usage.path}:${usage.line} ↗`, exact: true })).toHaveAttribute('href', sourceUrl);
  await expect(card.locator(`a[href="${sourceUrl}"]`)).toHaveAttribute('rel', /noopener/);

  await page.getByRole('button', { name: 'Git 스캔 가져오기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Git 스캔 가져오기' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByLabel('Git 스캔 JSON');
  await input.fill('{');
  await dialog.getByRole('button', { name: '소스 연결 저장' }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText('JSON 형식을 확인하세요.')).toBeVisible();
  await input.fill(JSON.stringify(fixture, null, 2));
  await noViolations(page);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/flag-sources') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: '소스 연결 저장' }).click();
  const imported = await response;
  expect(imported.status(), await imported.text()).toBe(201);
  expect(imported.request().headers()).toMatchObject({ 'x-actor-id': 'usr-integrator', 'x-actor-role': 'IMPLEMENTER' });
  expect(await imported.json()).toMatchObject({ manifestId: prior.manifestId, contentHash: prior.contentHash, importedBy: prior.importedBy, provenance: prior.provenance, manifest: fixture });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Git 소스 연결을 저장했습니다.' })).toBeVisible();
  await card.getByText('소스 파일 해시', { exact: true }).click();
  await expect(card).toContainText(usage.contentHash);

  const policies = await request.get(`${API}/api/feature-flags?featureId=FEAT-00022&version=1.0.0`);
  expect(policies.status(), await policies.text()).toBe(200);
  const row = (await policies.json()).find((r: any) => r.flagKey === 'care_00022_signal');
  expect(row?.policy?.policyId).toMatch(/^POL-\d{5}$/);
  if (row.publication) await expect(card.locator('[data-flag-stage="delivery"] a')).toHaveAttribute('href', `/deployments/${row.publication.publicationId}`);
  else await expect(card.locator('[data-flag-stage="delivery"]')).toContainText('서명 배포 기록 없음');
  const policyUrl = `/policies/${row.policy.policyId}`;
  await card.locator(`a[href="${policyUrl}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${policyUrl}$`));
  await settle(page);
  await page.locator('.ff-highlight[aria-label="Feature Flag"]').getByRole('link', { name: 'Flag 연결 보기 →' }).click();
  await expect(page).toHaveURL(new RegExp(`${FEATURE}\\?tab=flags$`));
  await card.locator(`a[href="${policyUrl}#unleash-h"]`).click();
  await expect(page).toHaveURL(new RegExp(`${policyUrl}#unleash-h$`));
  await expect(page.getByRole('heading', { name: 'Policy Tool 연계 (Unleash)' })).toBeVisible();
  await page.locator('.ff-highlight[aria-label="Feature Flag"]').getByRole('link', { name: 'Flag 연결 보기 →' }).click();
  await card.getByRole('link', { name: '코드 검토·MR 근거 →' }).click();
  await expect(page).toHaveURL(new RegExp(`${FEATURE}\\?tab=ext$`));
  await expect(page.getByRole('tab', { name: '연계', exact: true })).toHaveAttribute('aria-selected', 'true');
  await settle(page);
});

test('감사 담당자 — 소스·정책 조회는 가능하고 가져오기는 화면과 서버에서 거부', async ({ page, request }) => {
  await as(page, 'viewer');
  await open(page, `${FEATURE}?tab=flags`);
  const blocked = page.getByRole('button', { name: 'Git 스캔 가져오기', exact: true });
  await expect(blocked).toBeDisabled();
  const description = await blocked.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  await expect(page.locator(`[id="${description}"]`)).toContainText('구현 담당');
  await expect(page.locator('.ff-source a').first()).toHaveAttribute('href', new RegExp(`/blob/${fixture.commit}/`));
  const denied = await request.post(`${API}/api/flag-sources`, { headers: H('usr-viewer', 'AUDITOR'), data: fixture });
  expect(denied.status(), await denied.text()).toBe(403);
  expect((await denied.json()).error.code).toBe('FORBIDDEN');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await noViolations(page);
});

test('가상 차량 앱 — 스캔한 여섯 Flag 모두 해당 Feature에서 실제 커밋·파일·줄로 연결된다', async ({ page, request }) => {
  expect(fixture.usages).toHaveLength(6);
  const response = await request.get(`${API}/api/feature-flags`);
  expect(response.status(), await response.text()).toBe(200);
  const rows = await response.json();
  const groups = new Map<string, { flagKey: string; path: string; line: number }[]>();
  for (const source of fixture.usages) {
    const row = rows.find((r: any) => r.flagKey === source.flagKey && r.featureId && r.version && r.policy);
    expect(row, `${source.flagKey}의 실제 정책·Feature 연결`).toBeTruthy();
    expect(row.sources).toEqual(expect.arrayContaining([expect.objectContaining({ commit: fixture.commit, url: sourceUrlOf(source), contentHash: source.contentHash })]));
    const route = `/features/${row.featureId}/${row.version}?tab=flags`;
    groups.set(route, [...(groups.get(route) ?? []), source]);
  }
  await as(page, 'integrator');
  for (const [route, sources] of groups) {
    await open(page, route);
    for (const source of sources) {
      const card = page.locator('.ff-card').filter({ has: page.getByRole('heading', { name: source.flagKey, exact: true }) });
      await expect(card).toBeVisible();
      await expect(card.locator(`a[href="${sourceUrlOf(source)}"]`)).toBeVisible();
      await expect(card).toContainText('가상 차량 앱');
    }
  }
});

for (const size of [
  ...[1024, 1280, 1366, 1536, 1920].map((width) => ({ width, present: false })),
  ...[1366, 1920].map((width) => ({ width, present: true })),
]) test(`Flag 배치 @${size.width}${size.present ? ' 시연' : ''} — 강조 띠·탭·가져오기·읽기 전용`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: size.width, height: size.width >= 1920 ? 1080 : 800 });
  await as(page, 'integrator', size.present);
  await open(page, FEATURE);
  await expect(page.locator('.ff-highlight[aria-label="Feature Flag"]')).toBeVisible();
  await noLayoutDefects(page, 'Feature 첫 화면');

  await page.getByRole('tab', { name: 'Feature Flag', exact: true }).click();
  for (const flag of distanceUsages) await expect(page.locator('.ff-card').getByRole('heading', { name: flag.flagKey, exact: true })).toBeVisible();
  await page.locator('.ff-source summary').first().click();
  await noLayoutDefects(page, 'Feature Flag 상세·파일 해시');
  await page.getByRole('button', { name: 'Git 스캔 가져오기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Git 스캔 가져오기' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0);
  await noLayoutDefects(page, '비어 있는 가져오기 서랍', '.ds-drawer');
  await dialog.getByLabel('Git 스캔 JSON').fill(JSON.stringify(fixture, null, 2));
  await noLayoutDefects(page, '스캔을 입력한 가져오기 서랍', '.ds-drawer');
  await dialog.getByLabel('Git 스캔 JSON').fill('');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await as(page, 'viewer', size.present);
  await open(page, `${FEATURE}?tab=flags`);
  await expect(page.getByRole('button', { name: 'Git 스캔 가져오기', exact: true })).toBeDisabled();
  await noLayoutDefects(page, '읽기 전용 Feature Flag');
  await open(page, '/policies');
  await expect(page.locator('.ff-highlight[aria-label="Git 소스 연결"]')).toBeVisible();
  await noLayoutDefects(page, '읽기 전용 정책 첫 화면');
});
