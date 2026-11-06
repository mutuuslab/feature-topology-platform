// 차량 발신 요청 끝단 흐름 — 차량이 실제 백엔드(9111)에 조회·보고를 보내고, 운영자는 차량별 화면에서 처리·거부를 본다.
// KMH-NX4-0002만 쓴다 — ego-01(체험권)·lead-01(긴급 차단)은 다른 시험 파일이 병렬로 쓴다. 바꾼 관측값은 끝에 되돌린다.
import { expect, test, type Page } from '@playwright/test';
import { vehiclePost } from './vehicle';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const VIN = 'KMH-NX4-0002';
const FLAG = 'care_00022_param';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('차량 발신 요청: 조회 → 품질 저하 보고(재평가 HOLD) → Flag 직접 변경 거부 → 다른 VIN 거부 → 화면에 처리·거부 사유', async ({ page, request }) => {
  const boot = `BOOT-e2e-${Date.now()}`; // 재사용 서버에서도 새 부팅으로 시작
  const report = (sequence: number, body: Record<string, unknown>) =>
    vehiclePost(request, VIN, `/vehicle/v1/${VIN}/reports`, { bootId: boot, sequence, observedAt: new Date().toISOString(), ...body });

  // 차량은 서명한 요청만 보낼 수 있다(RD-SEC-08) — 머리글만 보내면 401
  expect((await request.post(`${API}/vehicle/v1/${VIN}/flags/${FLAG}`, { headers: { 'X-Vehicle-Id': VIN }, data: {} })).status()).toBe(401);
  const q = await vehiclePost(request, VIN, `/vehicle/v1/${VIN}/flags/${FLAG}`, {});
  expect(q.status()).toBe(200);
  const initial = await q.json(); // 이 차량의 시드 값(코호트·권한에 따라 다름) — 끝에서 같은 값으로 돌아와야 한다
  expect(initial).toMatchObject({ key: FLAG });

  expect((await report(0, { type: 'HELLO', highest: {} })).status()).toBe(200);
  const stale = await report(1, { type: 'CONTEXT', set: { quality: 'STALE' } });
  expect(stale.status()).toBe(200);
  expect((await stale.json()).flags.find((f: { key: string }) => f.key === FLAG)).toMatchObject({ metadata: { decision: 'HOLD', platformReason: 'CONTEXT_UNKNOWN' } });

  const override = await report(2, { type: 'OVERRIDE', flagKey: FLAG, value: true });
  expect(override.status()).toBe(403);
  expect((await override.json()).error.code).toBe('VEHICLE_OVERRIDE_FORBIDDEN');
  const trim = await report(3, { type: 'CONTEXT', set: { trim: 'Modern' } });
  expect(trim.status()).toBe(400);
  const other = await vehiclePost(request, VIN, '/vehicle/v1/ego-01/flags', {});
  expect(other.status()).toBe(403);

  await page.goto('/_design');
  await asRole(page, 'operator');
  await page.goto(`/fleet/vehicles/${VIN}`);
  const table = page.getByRole('table', { name: '차량 발신 요청' });
  await expect(table.getByRole('row', { name: /Flag 직접 변경 금지/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /신뢰 원천 속성 변경 금지/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /quality=STALE/ })).toContainText(FLAG);
  await expect(page.getByRole('region', { name: '차량 발신 요청' })).toContainText(`${boot} · #1`); // 거부된 보고(#2·#3)는 보고 위치를 움직이지 않는다

  // 되돌리기 — 다른 시험이 이 차량의 기본 상태를 기대할 수 있다
  const back = await report(4, { type: 'CONTEXT', set: { quality: 'TRUSTED' } });
  expect((await back.json()).flags.find((f: { key: string }) => f.key === FLAG)).toMatchObject({ value: initial.value });
});
