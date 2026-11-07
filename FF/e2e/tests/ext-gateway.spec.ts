// 묶음 P2 끝단 — 실제 백엔드에서 API 키 발급(원문 1회) → 키로 외부 시스템 호출 → 화면에서 삭제 → 같은 키 401,
// API 명세·버전(런타임 명세·지원 종료 410), 정산 전송(시드 실패 기록·보내기), Legacy 연계 설정 등록·삭제·변환 규칙 등록·코딩 메시지 변환.
// 화면은 접근성 위반(serious·critical) 0. 다른 시험이 쓰는 데이터(OPT-XHUD 미해석·TMA 주문)는 바꾸지 않는다.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

async function asRole(page: Page, role: string) {
  await page.goto('/_design');
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function noSeriousAxe(page: Page) {
  const r = await new AxeBuilder({ page }).include('.ds-screen').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
}

test('API 키: 발급 원문은 한 번 → 그 키로 외부 시스템 호출 → 화면에서 삭제하면 같은 키는 401', async ({ page, request }) => {
  await asRole(page, 'integrator');
  await page.goto('/integration/connectors?tab=apikeys');
  await expect(page.getByTestId('api-keys').getByRole('table')).toContainText('분기 감사 조회'); // 데모 시드
  await page.getByRole('button', { name: 'API 키 발급' }).click();
  const form = page.getByRole('dialog', { name: 'API 키 발급' });
  await form.getByLabel('키 이름').fill('e2e 주문 수집');
  await form.getByLabel('쓰는 외부 시스템').fill('e2e ERP');
  await form.getByLabel('발급 이유').fill('끝단 시험');
  await form.getByRole('button', { name: '발급' }).click();
  const shown = page.getByRole('dialog', { name: '발급한 키 원문' });
  const secret = (await shown.locator('code').innerText()).trim();
  expect(secret).toMatch(/^ffk_AK-\d{4}_[A-Za-z0-9_-]{43}$/);
  await shown.getByRole('button', { name: '확인했습니다' }).click();
  await expect(page.getByText(secret)).toHaveCount(0);

  const ok = await request.get(`${API}/api/legacy/orders`, { headers: { 'X-Api-Key': secret } });
  expect(ok.status()).toBe(200);
  const keyId = secret.split('_')[1];
  const row = page.getByRole('row').filter({ hasText: keyId });
  await expect(row).toContainText('사용 중');
  await noSeriousAxe(page);
  await row.getByRole('button', { name: '삭제' }).click();
  const rv = page.getByRole('dialog', { name: `${keyId} 삭제` });
  await rv.getByLabel('삭제 이유').fill('끝단 시험 종료');
  await rv.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByRole('row').filter({ hasText: keyId })).toContainText('삭제됨');
  const denied = await request.get(`${API}/api/legacy/orders`, { headers: { 'X-Api-Key': secret } });
  expect(denied.status()).toBe(401);
  expect((await denied.json()).error.code).toBe('UNAUTHENTICATED');
});

test('API 명세·버전: 명세 요약·버전 일정, 런타임 명세는 OpenAPI 3.0.3, 지원 종료 버전은 410', async ({ page, request }) => {
  await asRole(page, 'integrator');
  await page.goto('/integration/connectors?tab=apispec');
  const spec = page.getByTestId('api-spec');
  await expect(spec).toContainText(/경로 \d+개 · 연산 \d+개/);
  await expect(spec.getByRole('table', { name: '버전별 지원 일정' })).toContainText('지원 종료');
  await noSeriousAxe(page);
  const doc = await request.get(`${API}/api/openapi.json`);
  expect(doc.status()).toBe(200);
  expect((await doc.json()).openapi).toBe('3.0.3');
  const gone = await request.get(`${API}/api/features`, { headers: { 'X-Api-Version': '2025-12' } });
  expect(gone.status()).toBe(410);
  expect(gone.headers()['sunset']).toBeTruthy();
});

test('정산 전송: 상품별 사용량·실패 기록(사유)이 보이고, 지난 달을 보내면 전송 기록에 남는다', async ({ page }) => {
  await asRole(page, 'operator');
  await page.goto('/integration/connectors?tab=settlement');
  const tab = page.getByTestId('settlement');
  await expect(tab.getByRole('table', { name: '전송 기록' })).toContainText('정산 시스템 연계가 꺼져 있습니다'); // 시드 — 실패 뒤 재전송
  await expect(tab.getByRole('table', { name: '상품별 사용량' }).getByRole('row')).not.toHaveCount(1);
  // 시드가 보내지 않은 석 달 전
  const d = new Date();
  const period = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 7);
  await tab.getByLabel('정산 기간').selectOption(period);
  await expect(tab).toContainText('아직 보내지 않음');
  await tab.getByRole('button', { name: '정산 보내기' }).click();
  await expect(tab.getByText(/^보냄 — STL-\d{5}$/).first()).toBeVisible();
  await expect(tab.getByRole('table', { name: '전송 기록' }).getByRole('row').filter({ hasText: period }).first()).toContainText('보냄');
  await noSeriousAxe(page);
});

test('Legacy 연계: 연계 등록 → 브리지 → 삭제, 변환 규칙 등록, 코딩 메시지 변환 기록', async ({ page }) => {
  await asRole(page, 'integrator');
  await page.goto('/integration/legacy');
  const links = page.getByRole('region', { name: '연계 설정' });
  await expect(links.getByRole('table')).toContainText('ERP-TMA'); // 데모 시드
  await links.getByRole('button', { name: '연계 등록' }).click();
  const f = page.getByRole('dialog', { name: '연계 등록' });
  await f.getByLabel('시스템 코드').fill('DMS-E2E');
  await f.getByLabel('이름').fill('e2e 딜러 DMS');
  await f.getByLabel('연결 주소').fill('https://dms.e2e.example/coding');
  await f.getByRole('button', { name: '저장' }).click();
  const row = links.getByRole('row').filter({ hasText: 'DMS-E2E' });
  await expect(row).toContainText('중지');
  await row.getByText('DMS-E2E').click();
  await expect(page.getByRole('dialog')).toContainText('BRG-DMS-E2E');
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: '삭제' }).click();
  const rm = page.getByRole('dialog', { name: 'DMS-E2E 연계 삭제' });
  await rm.getByLabel('삭제 이유').fill('끝단 시험 종료');
  await rm.getByRole('button', { name: '삭제' }).click();
  await expect(links.getByRole('row').filter({ hasText: 'DMS-E2E' })).toHaveCount(0);

  await page.getByRole('button', { name: '규칙 등록', exact: true }).click();
  const r = page.getByRole('dialog', { name: '변환 규칙 등록' });
  await r.getByLabel('레거시 코드').fill('OPT-E2E1');
  await r.getByLabel('설명').fill('e2e 옵션');
  await r.getByLabel('대상 Feature').fill('FEAT-00014');
  await r.getByLabel('이유').fill('끝단 시험');
  await r.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('table', { name: '옵션 코드 매핑' }).getByRole('row').filter({ hasText: 'OPT-E2E1' })).toContainText('등록 · v1');
  await noSeriousAxe(page);

  await asRole(page, 'operator');
  await page.goto('/integration/legacy');
  await page.getByRole('button', { name: '코딩 메시지 받기' }).click();
  const m = page.getByRole('dialog', { name: '레거시 코딩 메시지 받기' });
  await m.getByLabel('코딩 위치(DID)').fill('F1024');
  await m.getByRole('button', { name: '변환' }).click();
  await expect(m.getByRole('status')).toContainText('FEAT-00024 ENABLED');
  await page.keyboard.press('Escape');
  // 같은 영역에 메시지 형식 표(P2 7f89707)가 함께 있다 — 변환 기록 표를 이름으로 고른다
  await expect(page.getByRole('region', { name: '메시지 변환 기록' }).getByRole('table', { name: '메시지 변환 기록' })).toContainText('대응하는 Feature가 없습니다'); // 시드 실패
});
