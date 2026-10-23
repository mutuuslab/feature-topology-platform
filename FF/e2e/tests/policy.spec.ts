// PoC ②③ 끝단 흐름 — 실제 백엔드와 v2 화면으로 정책 작성 → 8종 병렬 검증(GO) → 승인(작성자≠승인자) → 서버 배포 → 활성화 판단·OFREP.
// 테스트마다 자기 Feature를 새로 만들어 병렬 실행에서도 서로 간섭하지 않는다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

/** 정책을 붙일 수 있는 Feature — 등록·구현 연결·G1~G7 PASS·정의 승인(→ DEVELOPING) */
async function developingFeature(request: APIRequestContext) {
  const post = async (path: string, role: [string, string], data: unknown, code = 201) => {
    const r = await request.post(`${API}${path}`, { headers: H(...role), data });
    expect(r.status(), await r.text()).toBe(code);
    return r.json();
  };
  const author: [string, string] = ['usr-author', 'FEATURE_AUTHOR'];
  const judge: [string, string] = ['usr-quality', 'GATE_JUDGE'];
  const f = await post('/api/features', author, { name: `E2E 정책 ${Date.now() % 100000}`, description: 'P7 e2e', requirementIds: ['REQ-E2E-P7'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] });
  const base = `/api/features/${f.featureId}/versions/0.1.0`;
  const p = await request.patch(`${API}${base}`, { headers: H(...author), data: { functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] } });
  expect(p.status(), await p.text()).toBe(200);
  // 안전 분류 확정(Safety Manager) 없이는 G2 이후 PASS가 막힌다 — FFG-CLS-001
  await post(`${base}/safety/confirm`, ['usr-safety', 'SAFETY_OFFICER'], { reason: 'HARA 검토 완료' });
  for (const g of ['G1', 'G2', 'G3']) await post(`${base}/gates`, judge, { gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` });
  await post(`${base}/transitions`, ['usr-approver', 'FEATURE_APPROVER'], { to: 'APPROVED', reason: '승인' }, 200);
  for (const g of ['G4', 'G5', 'G6', 'G7']) await post(`${base}/gates`, judge, { gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` });
  return f.featureId as string;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('정책: 작성 → 8종 검증 GO → 승인 → Feature VERIFIED → 서버 배포 → 활성화 판단', async ({ page, request }) => {
  const fid = await developingFeature(request);
  const flagKey = `care_${fid.slice(5)}_flag`;

  // 작성 (Feature 설계)
  await asRole(page, 'author');
  await page.goto('/policies/new');
  await page.getByLabel('Feature ID', { exact: true }).fill(fid);
  await page.getByLabel('Version', { exact: true }).fill('0.1.0');
  await page.getByLabel('flagKey', { exact: true }).fill(flagKey);
  await page.getByLabel('설명', { exact: true }).fill('e2e 시험 Flag');
  await page.getByRole('button', { name: '새 정책' }).last().click();
  await expect(page).toHaveURL(/\/policies\/POL-\d{5}$/);
  const pid = page.url().split('/').pop()!;
  await expect(page.getByText('아직 검증하지 않았습니다')).toBeVisible();

  // 분야별 검증 8종 — 병렬 실행, 배포 안전성 GO
  await page.getByRole('button', { name: '분야별 검증 실행' }).click();
  const grid = page.getByRole('list', { name: '분야별 검증 8종 (병렬)' });
  await expect(grid.getByRole('listitem')).toHaveCount(8);
  await expect(page.getByText(/GO — 승인 가능/)).toBeVisible();
  // 작성자는 승인할 수 없다
  await expect(page.getByRole('button', { name: /정책 승인/ })).toBeDisabled();

  // 승인 (작성자≠승인자) — 승인과 함께 Feature가 VERIFIED로 자동 전이
  await asRole(page, 'approver');
  await page.reload();
  await page.getByRole('button', { name: /정책 승인/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('사유', { exact: false }).fill('8종 GO 확인 — e2e');
  await dlg.getByRole('button', { name: '정책 승인' }).click();
  await expect(page.getByText('APPROVED', { exact: true }).first()).toBeVisible();
  const f = await (await request.get(`${API}/api/features/${fid}/versions/0.1.0`)).json();
  expect(f.feature.lifecycle).toBe('VERIFIED');

  // 서버 배포 — 출시 담당(협의 이관 계정, RELEASE_MANAGER). 승인자는 출시를 겸하지 않는다(FFG-PLT-016)
  await asRole(page, 'coordinator');
  await page.reload();
  await page.getByRole('button', { name: '서버 배포' }).click();
  await page.getByRole('dialog').getByLabel('사유', { exact: false }).fill('e2e 배포');
  await page.getByRole('dialog').getByRole('button', { name: '서버 배포' }).click();
  await expect(page.getByText('DEPLOYED', { exact: true }).first()).toBeVisible();

  // 감사 이력에 승인·배포가 남는다
  const audit = await (await request.get(`${API}/api/audit?target=${pid}`)).json();
  expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['POLICY_CREATE', 'POLICY_VALIDATE', 'POLICY_APPROVE', 'POLICY_DEPLOY']));

  // 활성화 판단 — 같은 평가기가 서버 판단과 OFREP 응답을 만든다 (적용 범위 KR/NX4 PE/Premium인 ego-01)
  await page.getByRole('link', { name: '활성화 판단 →' }).click();
  await expect(page).toHaveURL(new RegExp(`/activation/decide\\?flagKey=${flagKey}`));
  // 판정은 화면 머리의 핵심 메시지 하나(3초 테스트)
  await expect(page.locator('#main [data-key-message] .ds-key__status')).toHaveText('ON'); // 낱말 상태는 상태 pill(하네스 3판 ⑧)
  await expect(page.locator('.ds-trace li')).toHaveCount(8); // 배포·차단·범위·지원 조건(FFG-VEH-006)·권한·대상·코호트·판정
  await expect(page.getByRole('region', { name: 'OFREP 응답' }).locator('pre')).toContainText(`"key": "${flagKey}"`);
});

// 체험권 제안·수락·구매 전환 흐름은 trials.spec.ts
