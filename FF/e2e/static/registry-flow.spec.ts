// 공개 시연 사이트 — Feature Registry 흐름을 브라우저 안 시연 데이터로 끝까지(설계 docs/20-architecture/20-61-browser-simulator.md, handlers/registry).
//  ① 제안(Feature 등록) → 안전 분류 확정·HARA(기능안전) → Gate G1~G3(품질) → 정의 승인(구성 승인) → Baseline 요청(작성) → 결정(PLM 기준정보)
//  ② Release Sign-off(Feature Owner) → 출시(출시 담당) — 알림 종·감사가 같은 상태
//  ③ Feature DB 변경 요청(작성) → 도메인 검토(구성 승인) → 승인(Feature DB 관리자) + 업무 절차 활동 완료 → 다음 담당 검토함
// 단계별 화면은 SHOTS 폴더(1366 폭)에 남긴다.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { pickPrimaryRef, submitProposedFeature } from '../tests/refdb';

const SHOTS = process.env.REGISTRY_SHOTS ?? 'C:/tmp/ff-static-audit/pw-out/registry/shots';
let n = 0;
const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` });
};
/** 데모 역할 전환(상단 역할 선택) — 역할 홈으로 옮겨 간 뒤 원하는 화면으로 */
async function as(page: Page, role: string, url: string) {
  await page.getByRole('combobox', { name: '역할', exact: true }).selectOption(role);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(url);
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('FF');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
}
const main = (page: Page) => page.locator('#main');
const drawer = (page: Page) => page.getByRole('dialog');
/** Gate 판정 폼 — Gate 레일에서 고르고 PASS·Evidence·사유 */
async function judge(page: Page, gate: string, evidence: string) {
  await main(page).getByRole('button', { name: new RegExp(`^${gate} `) }).first().click();
  await main(page).getByRole('combobox', { name: '입력 검사 결과' }).selectOption('PASS');
  await main(page).getByRole('textbox', { name: /^Evidence Ref/ }).fill(evidence);
  await main(page).getByRole('textbox', { name: '사유', exact: true }).fill(`${gate} 기준 충족 — 시연 판정`);
  await main(page).getByRole('button', { name: `${gate} · Gate 판정 등록` }).click();
  await expect(main(page).getByRole('button', { name: new RegExp(`^${gate} .*PASS`) })).toBeVisible({ timeout: 15_000 });
}

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });

test('정적 시연: Feature 제안 → 안전 분류·HARA → Gate G1~G3 → 정의 승인 → Baseline 요청·결정', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  // 1. 작성 — Feature DB 대표 기준 선택 → 문서 편집 → 적용 범위 확인 → 제안 등록
  await as(page, 'author', '/feature/propose');
  await pickPrimaryRef(page, 'AD-PRK-004', 'AD-PRK-004');
  await main(page).getByLabel('이름').fill('서라운드 뷰 주차 안내 · 시연');
  await main(page).getByLabel(/요구사항 ID/).fill('REQ-PARK-0301');
  await main(page).getByLabel('트림').fill('Signature');
  await main(page).getByLabel(/UPG-VC/).fill('F111A111001');
  await main(page).getByLabel('담당').fill('Parking기획팀');
  for (const cb of await main(page).getByRole('group', { name: 'Control Point' }).getByRole('checkbox').all()) if (await cb.isChecked()) await cb.uncheck();
  await shot(page, 'propose-confirm');
  await submitProposedFeature(page);
  await page.waitForURL(/\/features\/FEAT-\d{5}\/0\.1\.0/);
  const [, id] = /\/features\/(FEAT-\d{5})\/0\.1\.0/.exec(page.url())!;
  await expect(main(page)).toContainText('서라운드 뷰 주차 안내 · 시연');
  await expect(main(page)).toContainText('제안');
  await shot(page, 'registered');

  // 같은 상태를 목록도 — Feature 목록(최신 Version)에 새 Feature
  await page.goto(`/features?q=${id}`);
  await expect(main(page).getByRole('row', { name: new RegExp(id) })).toContainText('PROPOSED');

  // 2. 기능안전(품질) — 안전 분류 확정(개인 서명) → HARA 기록
  await as(page, 'quality', `/features/${id}/0.1.0?tab=safety`);
  await page.locator('[data-ui=confirmSafetyProfile]').click();
  await drawer(page).locator('textarea, input').first().fill('분류 확인 — F1·DC1·R0');
  await drawer(page).getByRole('button', { name: /확정/ }).last().click();
  await expect(main(page)).toContainText('확정자');
  await main(page).locator('[data-ui=recordHara]').click();
  const hara = drawer(page);
  await hara.getByLabel(/문서 번호/).fill('HARA-SVM-2026-01');
  await hara.locator('input').nth(1).fill('SG-SVM-01');
  await hara.locator('input').nth(2).fill('주차 안내 오표시로 충돌하는 일을 막는다');
  await hara.locator('textarea').last().fill('최초 위험 분석');
  await hara.getByRole('button', { name: /서명/ }).last().click();
  await expect(main(page).locator('[data-ui=recordHara]')).toBeVisible();
  await expect(main(page)).toContainText(/ANL-\d{5}/);
  const anl = (/ANL-\d{5}/.exec(await main(page).innerText()) ?? [''])[0];
  await shot(page, 'safety-confirmed-hara');

  // 3. Gate G1~G3 — 품질 판정(G2 근거는 HARA 기록 번호)
  await page.goto(`/features/${id}/0.1.0?tab=gates`);
  await judge(page, 'G1', 'EV-SVM-G1');
  await judge(page, 'G2', anl);
  await judge(page, 'G3', 'EV-SVM-G3');
  await expect(main(page)).toContainText('3/9');
  await shot(page, 'gates-judged');

  // 4. 구성 승인 — 알림 종에 Gate 판정, 정의 승인(작성자는 막힘)
  await as(page, 'approver', `/features/${id}/0.1.0`);
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText(`G3 PASS — ${id} 0.1.0`);
  await page.keyboard.press('Escape');
  await main(page).getByRole('button', { name: /APPROVED로 전이|정의 승인/ }).first().click();
  await drawer(page).locator('textarea').fill('정의·요구사항·사양 확인 — 승인');
  await drawer(page).getByRole('button', { name: '실행' }).click();
  await expect(main(page).getByRole('button', { name: /APPROVED로 전이/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Version' })).toBeVisible();
  await shot(page, 'approved');

  // 5. 작성 — Baseline 확정 요청(BOM Baseline 탭)
  await as(page, 'author', `/features/${id}/0.1.0?tab=baseline`);
  await main(page).getByRole('textbox', { name: '사유', exact: true }).fill('정의 승인 Version 기준선 확정 요청');
  await main(page).getByRole('button', { name: 'Baseline 확정 요청' }).click();
  await expect(main(page)).toContainText(/BR-\d{5}/);
  const br = (/BR-\d{5}/.exec(await main(page).innerText()) ?? [''])[0];
  await shot(page, 'baseline-requested');

  // 6. PLM 기준정보 — 대기열에서 체크리스트 확인 후 확정 → BL 발급, Feature 상세에 Baseline
  await as(page, 'steward', `/baselines?request=${br}`);
  await expect(drawer(page)).toContainText(br);
  await drawer(page).locator('textarea').fill('체크리스트 통과 — 확정');
  await drawer(page).getByRole('button', { name: /확정|승인/ }).first().click();
  await expect(drawer(page)).toContainText(/BL-\d{5}|확정/);
  await shot(page, 'baseline-decided');
  await page.goto(`/features/${id}/0.1.0?tab=baseline`);
  await expect(main(page)).toContainText(/BL-\d{5}/);

  // 7. 감사 — 이 Version의 기록(등록·안전 분류·Gate·전이·Baseline)
  await page.goto(`/features/${id}/0.1.0?tab=audit`);
  for (const a of ['Feature 등록', '안전 분류 확정', 'HARA 판단 기록', 'Gate 판정 G2', 'PROPOSED→APPROVED', 'Baseline 확정 요청', 'BASELINE_APPROVE']) await expect(main(page).getByRole('row', { name: new RegExp(`${a}.*허용`) }).first()).toBeVisible();
  await shot(page, 'audit');
  expect(errors).toEqual([]);
});

test('정적 시연: Release Sign-off → 출시 — 알림·감사가 같은 상태, 처음 상태로 되돌리기', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const F = '/features/FEAT-00144/3.3.0';
  // 출시 담당 — 서명 전에는 출시 전이가 막혀 있다(막힌 조건: Release Sign-off 없음)
  await as(page, 'coordinator', F);
  await main(page).getByRole('button', { name: /RELEASED로 전이/ }).click();
  await expect(drawer(page)).toContainText('Release Sign-off');
  await expect(drawer(page).getByRole('button', { name: '실행' })).toBeDisabled();
  await drawer(page).getByRole('button', { name: '닫기' }).click();
  // Feature Owner — 서명
  await as(page, 'author', F);
  await page.locator('[data-ui=signRelease]').click();
  await drawer(page).locator('textarea').fill('G8·G9 PASS 확인 — 출시 책임 확인');
  await drawer(page).getByRole('button', { name: /서명/ }).last().click();
  await expect(page.getByTestId('release-signoff')).not.toContainText('없습니다');
  await expect(page.locator('[data-ui=signRelease]')).toHaveCount(0);
  await shot(page, 'release-signed');
  // 출시 담당 — 알림 종에 차례, 출시 전이
  await as(page, 'coordinator', F);
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText('Release Sign-off 완료 — FEAT-00144 3.3.0 출시 차례');
  await page.keyboard.press('Escape');
  await main(page).getByRole('button', { name: /RELEASED로 전이/ }).click();
  await drawer(page).locator('textarea').fill('출시 승인 — Sign-off·G8·G9 확인');
  await drawer(page).getByRole('button', { name: '실행' }).click();
  await expect(main(page).getByRole('button', { name: /DEPRECATED로 전이/ })).toBeVisible();
  await shot(page, 'released');
  // 감사 화면 — 같은 기록
  await page.goto('/audit?prefix=FEAT-00144@3.3.0');
  await expect(main(page)).toContainText('RELEASE_SIGNOFF');
  await expect(main(page)).toContainText('VERIFIED→RELEASED');
  // 처음 상태로
  await page.getByTestId('demo-reset-open').click();
  await page.getByTestId('demo-reset').getByRole('button', { name: '처음 상태로 되돌리기' }).click();
  await page.goto(F);
  await expect(main(page).getByRole('button', { name: /RELEASED로 전이/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('정적 시연: Feature DB 변경 요청 → 도메인 검토 → 승인, 업무 절차 활동 완료 → 다음 담당 차례', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  // 1. 작성 — 기준 행 상세에서 수정 요청(T-shirt)
  await as(page, 'author', '/master/feature-db/AD-PRK-001');
  await main(page).getByRole('button', { name: '변경 요청' }).click();
  const form = drawer(page);
  const size = form.getByRole('combobox', { name: 'T-shirt' });
  const cur = await size.inputValue();
  await size.selectOption(cur === 'XL' ? 'L' : 'XL');
  await form.getByRole('textbox', { name: '요청 사유' }).fill('사내 실적 3건 반영 — 규모 재평가');
  await form.getByRole('button', { name: '변경 요청 보내기' }).click();
  await expect(main(page)).toContainText(/CR-\d{4}-\d{3}/);
  const cr = (/CR-\d{4}-\d{3}/.exec(await main(page).innerText()) ?? [''])[0];
  await shot(page, 'refchange-created');
  // 2. 도메인 검토(구성 승인) — 알림 종의 요청, 동의 의견
  await as(page, 'approver', `/master/feature-db/changes/${cr}`);
  await expect(main(page)).toContainText(cr);
  await main(page).getByRole('textbox', { name: '검토 내용' }).fill('사내 실적 근거 확인 — 동의');
  await main(page).getByRole('button', { name: '검토 의견 보내기' }).click();
  await expect(main(page)).toContainText('사내 실적 근거 확인 — 동의');
  // 3. Feature DB 관리자 — 승인(요청자·검토자가 아님) → 발행 대기
  await as(page, 'steward', `/master/feature-db/changes/${cr}`);
  await main(page).getByRole('textbox', { name: '결정 사유' }).fill('근거 확인 — 승인');
  await main(page).getByRole('button', { name: '승인', exact: true }).click();
  await expect(main(page)).toContainText(/발행 대기|승인됨/);
  await shot(page, 'refchange-approved');
  await page.goto('/master/feature-db/changes');
  await expect(main(page).getByRole('row', { name: new RegExp(cr) })).toBeVisible();
  // 4. 업무 절차 — Feature Owner가 등록 활동을 Evidence·개인 서명으로 마치면 PLM 기준정보 차례
  await as(page, 'author', '/procedures/FPW.1?a=FPW.1-A01');
  await main(page).getByRole('button', { name: 'Evidence·서명' }).click();
  await drawer(page).getByRole('checkbox', { name: /개인 서명/ }).check();
  await drawer(page).getByRole('button', { name: '완료로 표시' }).click();
  await expect(main(page).getByRole('button', { name: '완료 취소' })).toBeVisible();
  await shot(page, 'procedure-done');
  await as(page, 'steward', '/procedures/FPW.1?a=FPW.1-A02');
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText('Feature 등록·초안 작성');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('정적 시연: 직무 분리 — Feature DB 관리자는 자기가 낸 변경 요청을 승인할 수 없다', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  // 관리자가 기준 행 수정 요청을 낸다(관리자도 요청할 수 있다)
  await as(page, 'steward', '/master/feature-db/AD-PRK-002');
  await main(page).getByRole('button', { name: '변경 요청' }).click();
  const size = drawer(page).getByRole('combobox', { name: 'T-shirt' });
  await size.selectOption((await size.inputValue()) === 'XL' ? 'L' : 'XL');
  await drawer(page).getByRole('textbox', { name: '요청 사유' }).fill('외부 공개 자료 개정 반영');
  await drawer(page).getByRole('button', { name: '변경 요청 보내기' }).click();
  await expect(main(page)).toContainText(/CR-\d{4}-\d{3}/);
  const cr = (/CR-\d{4}-\d{3}/.exec(await main(page).innerText()) ?? [''])[0];
  // 도메인 검토(동의)를 받아도 요청자인 관리자에게 승인·반려가 막히고, 막힌 이유가 보인다
  await as(page, 'approver', `/master/feature-db/changes/${cr}`);
  await main(page).getByRole('textbox', { name: '검토 내용' }).fill('공개 자료 개정 확인 — 동의');
  await main(page).getByRole('button', { name: '검토 의견 보내기' }).click();
  await expect(main(page)).toContainText('공개 자료 개정 확인 — 동의');
  await as(page, 'steward', `/master/feature-db/changes/${cr}`);
  const decide = main(page);
  await decide.getByRole('textbox', { name: '결정 사유' }).fill('본인 요청 승인 시도');
  await expect(decide.getByRole('button', { name: '승인', exact: true })).toBeDisabled();
  await expect(decide.getByRole('button', { name: '반려', exact: true })).toBeDisabled();
  await expect(decide).toContainText('변경 요청자는 자기 요청을 승인·반려할 수 없습니다');
  await shot(page, 'refchange-duty-blocked');
  expect(errors).toEqual([]);
});
