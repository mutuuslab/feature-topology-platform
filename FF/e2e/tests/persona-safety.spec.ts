// 담당자 시나리오(W3 — 기능안전·보안·법규·품질, persona-findings P3-1·3·4·9·10) — 실제 백엔드(메모리 DB·v0.81)와 화면으로:
//   Safety Manager가 HARA, CSM이 TARA, 법규 담당이 형식승인 영향을 서명해 남기고(분석 근거 패널),
//   Gate 판정자가 G2 패널에서 "대표 ASIL B → C · 사유"를 보고 'ASIL 사유 검토함'을 골라 PASS,
//   G7은 SM·CSM 두 사람 서명 뒤에만 PASS(같은 사람 두 역할 거부). 단계 밖 Gate는 제출 전에 막히고 오류에 코드가 붙지 않는다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRefs, REF } from './refdb';

test.use({ actionTimeout: 10_000 });

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function post(request: APIRequestContext, path: string, who: [string, string], data: unknown, code = 201) {
  const r = await request.post(`${API}${path}`, { headers: H(...who), data });
  expect(r.status(), await r.text()).toBe(code);
  return r.json();
}

/** 대표 기준 행 CH-BRK-009(오토 홀드, 대표 ASIL B)를 쓰면서 ASIL C로 등록 — 등록 때 사유를 남긴다 */
async function deviatedFeature(request: APIRequestContext) {
  const f = await post(request, '/api/features', ['usr-author', 'FEATURE_AUTHOR'], {
    name: `E2E 안전 근거 ${uniq()}`,
    description: '담당자 시나리오 — 분석 근거·G2·G7',
    requirementIds: ['REQ-E2E-W3'],
    country: 'KR',
    vehicleModel: 'NX4 PE',
    trim: 'Premium',
    ownerId: 'ADAS상품기획팀',
    asil: 'C',
    upgVc: ['F111A114001'],
    controlPoints: ['Flag'],
    ...apiRefs(REF.avh),
    asilDeviation: { from: 'B', to: 'C', reason: '경사로 정차 유지 실패 위험으로 HARA가 ASIL C 평가' },
  });
  const base = `/api/features/${f.featureId}/versions/0.1.0`;
  const p = await request.patch(`${API}${base}`, { headers: H('usr-author', 'FEATURE_AUTHOR'), data: { functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] } });
  expect(p.status(), await p.text()).toBe(200);
  return { id: f.featureId as string, base };
}

/** 분석 근거 패널에서 한 종류를 서명해 남긴다 */
/** 화면 패널(섹션) — Panel id는 제목 요소(<id>-h)에 붙는다 */
const section = (page: Page, id: string) => page.locator('section', { has: page.locator(`#${id}-h`) });

async function signRecord(page: Page, kind: string, fillForm: (form: ReturnType<Page['getByTestId']>) => Promise<void>) {
  const row = section(page, 'safety-analysis').locator(`li[data-kind="${kind}"]`);
  await row.getByRole('button', { name: '서명해 남기기' }).click();
  const form = page.getByTestId(`analysis-form-${kind}`);
  await fillForm(form);
  await form.getByRole('button', { name: '서명해 남기기' }).click();
  await expect(row).toHaveAttribute('data-state', 'PASS');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('SM HARA · CSM TARA · 법규 판단 → 판정자가 ASIL 사유를 보고 G2 PASS → G7은 SM·CSM 두 사람 서명 뒤 PASS', async ({ page, request }) => {
  const { id, base } = await deviatedFeature(request);
  await post(request, `${base}/gates`, ['usr-quality', 'GATE_JUDGE'], { gate: 'G1', inputResult: 'PASS', rationale: '정의 확인', evidenceRef: 'EV-W3-G1' });

  // 1) Safety Manager(두 번째 FSM 계정) — 안전 분류 확정 + HARA
  await asRole(page, 'safety2');
  await page.goto(`/features/${id}/0.1.0?tab=safety`);
  const panel = section(page, 'safety-analysis');
  await expect(panel.getByTestId('asil-deviation')).toContainText('대표 ASIL B → C · 경사로 정차 유지 실패 위험으로 HARA가 ASIL C 평가');
  await expect(panel.getByTestId('security-relevance')).toContainText('G2에 TARA가 필요합니다');
  // TARA는 CSM 몫 — SM 계정에는 이유와 함께 막힌다
  await expect(panel.locator('li[data-kind="TARA"]').getByRole('button', { name: '서명해 남기기' })).toBeDisabled();
  await signRecord(page, 'HARA', async (form) => {
    await form.getByLabel('분석 문서 번호').fill('HARA-AVH-2026-01');
    await form.getByLabel('HARA 평가 ASIL').selectOption('C');
    await form.getByLabel('목표 ID').fill('SG-AVH-01');
    await form.getByLabel('안전 목표', { exact: true }).fill('경사로 정차 중 의도하지 않은 밀림을 막는다');
    await form.getByRole('group', { name: '안전 목표', exact: true }).getByRole('combobox').selectOption('C');
    await form.getByLabel('서명 사유').fill('HARA 검토 완료');
  });
  await expect(panel.locator('li[data-kind="HARA"]')).toContainText('오세린(기능안전 담당) 서명');
  await expect(panel.getByTestId('asil-deviation')).toContainText('HARA 평가 ASIL C — 변경한 ASIL과 같습니다');
  await post(request, `${base}/safety/confirm`, ['usr-safety2', 'SAFETY_OFFICER'], { reason: '안전 분류 확정' });

  // 2) CSM(시스템 연계 계정 — 사이버보안 역할) — TARA
  await asRole(page, 'integrator');
  await page.goto(`/features/${id}/0.1.0?tab=safety`);
  await signRecord(page, 'TARA', async (form) => {
    await form.getByLabel('분석 문서 번호').fill('TARA-AVH-2026-01');
    await form.getByLabel('시나리오 ID').fill('TS-AVH-01');
    await form.getByLabel('위협 시나리오', { exact: true }).fill('브레이크 유지 신호 재전송');
    await form.getByLabel('CAL').selectOption('CAL3');
    await form.getByLabel('서명 사유').fill('TARA 검토 완료');
  });

  // 아키텍트(SW 통합 역할) — SOTIF 유발 조건도 같은 기록·서명 경로를 따른다
  await signRecord(page, 'SOTIF', async (form) => {
    await form.getByLabel('분석 문서 번호').fill('SOTIF-AVH-2026-01');
    await form.getByLabel('유발 조건(한 줄에 하나)', { exact: true }).fill('급경사·저마찰 노면에서 정차 유지');
    await form.getByLabel('서명 사유').fill('의도된 기능의 한계 검토 완료');
  });
  await expect(section(page, 'safety-analysis').locator('li[data-kind="SOTIF"]')).toContainText('급경사·저마찰 노면에서 정차 유지');

  // 3) 법규 담당(PLM 기준정보 계정) — 형식승인 영향 판단
  await asRole(page, 'steward');
  await page.goto(`/features/${id}/0.1.0?tab=safety`);
  await signRecord(page, 'HOMOLOGATION', async (form) => {
    await form.getByLabel('판단').selectOption('NOTIFY');
    await form.getByLabel('R155').check();
    await form.getByLabel('R13H').check();
    await form.getByLabel('서명 사유').fill('제동 기능 변경 — 기술 기관 통보');
  });
  await expect(section(page, 'safety-analysis').locator('li[data-kind="HOMOLOGATION"]')).toContainText('기술 기관 통보 · R155, R13H');

  // 4) Gate 판정자 — 단계 밖 G4는 제출 전에 막힘, G2 패널에 ASIL 사유·검토 확인
  await asRole(page, 'quality');
  await page.goto(`/features/${id}/0.1.0?tab=gates`);
  const judge = section(page, 'judge');
  await page.locator('.ds-gate[data-gate="G4"]').click();
  await expect(page.getByTestId('gate-stage-blocked')).toContainText('G4은(는) DEVELOPING 단계 Gate입니다');
  await expect(judge.getByRole('button', { name: 'G4 · Gate 판정 등록' })).toBeDisabled();

  await page.locator('.ds-gate[data-gate="G2"]').click();
  await expect(page.getByTestId('procedure-gate')).toContainText('절차 G2 HARA 영향 = 플랫폼 G2 Requirement Gate + G7 Safety/Security Gate');
  await expect(judge.getByTestId('asil-deviation')).toContainText('대표 ASIL B → C · 경사로 정차 유지 실패 위험');
  await judge.getByLabel('Evidence Ref').fill('TMS-W3-G2');
  await judge.getByLabel('사유', { exact: true }).fill('HARA·TARA·형식승인 판단 확인');
  await expect(judge.getByTestId('gate-needs')).toContainText('ASIL 사유 검토함');
  await expect(judge.getByRole('button', { name: 'G2 · Gate 판정 등록' })).toBeDisabled();
  await judge.getByRole('checkbox', { name: /ASIL 사유 검토함/ }).check();
  await expect(judge.getByTestId('gate-needs')).toHaveCount(0);
  await judge.getByRole('button', { name: 'G2 · Gate 판정 등록' }).click();
  await expect(page.locator('.ds-gate[data-gate="G2"]')).toHaveAttribute('data-status', 'PASS');
  await expect(section(page, 'gate-hist')).not.toContainText('GUARD_FAILED');

  // Evidence 칸은 원장 딥링크 — 새 판정 Evidence가 보인다
  await section(page, 'gate-hist').getByRole('link', { name: 'TMS-W3-G2' }).click();
  await expect(page).toHaveURL(/\/verify\/evidence\?ref=TMS-W3-G2&feature=/);
  await expect(page.getByRole('cell', { name: 'TMS-W3-G2' })).toBeVisible();

  // 정의 승인 → 개발 단계, G4~G6(API)
  await post(request, `${base}/gates`, ['usr-quality', 'GATE_JUDGE'], { gate: 'G3', inputResult: 'PASS', rationale: '사양 확인', evidenceRef: 'EV-W3-G3' });
  await post(request, `${base}/transitions`, ['usr-approver', 'FEATURE_APPROVER'], { to: 'APPROVED', reason: '정의 승인' }, 200);
  for (const g of ['G4', 'G5', 'G6']) await post(request, `${base}/gates`, ['usr-quality', 'GATE_JUDGE'], { gate: g, inputResult: 'PASS', rationale: `${g} 확인`, evidenceRef: `EV-W3-${g}` });

  // 5) G7 — 서명 전에는 판정 폼이 필요한 서명을 보이고 막는다
  await page.goto(`/features/${id}/0.1.0?tab=gates`);
  await page.locator('.ds-gate[data-gate="G7"]').click();
  await judge.getByLabel('Evidence Ref').fill('EV-W3-G7');
  await judge.getByLabel('사유', { exact: true }).fill('안전·보안 확인');
  await expect(judge.getByTestId('gate-needs')).toContainText('Safety Manager');
  await expect(judge.getByTestId('gate-needs')).toContainText('CSM');
  await expect(judge.getByRole('button', { name: 'G7 · Gate 판정 등록' })).toBeDisabled();

  // CSM 서명(화면)
  await asRole(page, 'integrator');
  await page.goto(`/features/${id}/0.1.0?tab=safety`);
  const g7 = page.getByTestId('g7-signoffs');
  await g7.getByLabel('서명 사유').fill('TARA 위협 대응 확인');
  await g7.getByRole('button', { name: 'G7 사이버보안 서명' }).click();
  await expect(g7).toContainText('윤도현(시스템 연계) 서명');
  // 같은 사람이 기능안전 역할로 또 서명 — 거부(서로 다른 두 사람)
  const same = await request.post(`${API}${base}/analysis/g7-safety`, { headers: H('usr-integrator', 'SAFETY_OFFICER'), data: { reason: '같은 사람' } });
  expect(same.status()).toBe(422);
  expect((await same.json()).error.message).toContain('서로 다른 사람');

  // SM 서명(화면)
  await asRole(page, 'safety2');
  await page.goto(`/features/${id}/0.1.0?tab=safety`);
  await g7.getByLabel('서명 사유').fill('HARA 안전 목표 반영 확인');
  await g7.getByRole('button', { name: 'G7 기능안전 서명' }).click();
  await expect(g7).toContainText('오세린(기능안전 담당) 서명');

  // 판정자 — 이제 G7 PASS
  await asRole(page, 'quality');
  await page.goto(`/features/${id}/0.1.0?tab=gates`);
  await page.locator('.ds-gate[data-gate="G7"]').click();
  await judge.getByLabel('Evidence Ref').fill('EV-W3-G7');
  await judge.getByLabel('사유', { exact: true }).fill('SM·CSM 서명 확인');
  await expect(judge.getByTestId('gate-needs')).toHaveCount(0);
  await judge.getByRole('button', { name: 'G7 · Gate 판정 등록' }).click();
  await expect(page.locator('.ds-gate[data-gate="G7"]')).toHaveAttribute('data-status', 'PASS');
});
