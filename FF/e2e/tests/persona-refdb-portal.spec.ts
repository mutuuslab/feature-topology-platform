// 담당자 시나리오 W5(2026-11-05) — Feature DB 운영·감사·SW개발비 및 정보보안이 막다른 길 없이 끝까지 간다.
//   ① Feature DB 관리자: 발행 칸에서 묶일 요청(승인 + 반려 → 폐기)·알림 받을 담당·품질 변화를 미리 보고, 미리 채운 메모로 발행 →
//      발행 버전 표에 메모·발행자. 출처 탭: 다음 점검일 없는 출처 경고, 점검 결과 '개정 있음' → 영향 행 목록으로
//   ② 감사(조회 계정): 변경 요청 상세 '감사 이력' 한 패널에서 요청·검토·결정을 보고, 감사 화면(앞부분 검색)으로 이어 한글 행위 이름을 본다
//   ③ 법무·구매·개인정보보호: 포털 요청함(실제 협의 건·기한) → '검토할 것 한 장'에서 동의·보완·반대 + 메모 → 요청 부서 홈과 감사에 보인다
// 근거: C:\tmp\ff-dept\persona-findings.md P5-1·P5-2·P5-4·P5-5·P5-6·P5-10·P5-12
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bodyCodes } from './key-message-rules';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const AUTHOR = H('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = H('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = H('usr-steward', 'REFDB_ADMIN');
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();
/** 포털 화면에 보이면 안 되는 전문용어(P5-12) */
const JARGON = /\bGate\b|\bSLA\b|\bOTA\b|Inputs|Outputs|레인|FPW\.\d|수행·책임지는 활동이 없습니다/;

async function as(page: Page, role: string, department = 'ALL') {
  await page.evaluate(
    ([r, d]) => {
      const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
      s.role = r;
      s.department = d;
      localStorage.setItem('fp.state.v2', JSON.stringify(s));
    },
    [role, department],
  );
}

async function call(request: APIRequestContext, method: 'post' | 'get', path: string, headers: Record<string, string>, data?: unknown) {
  const r = await request[method](`${API}${path}`, { headers, data });
  expect(r.ok(), `${method} ${path} → ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

/** 등록 화면 추가 요청 → 도메인 검토 → 관리자 결정 */
async function decidedAdd(request: APIRequestContext, nameKo: string, decision: 'APPROVE' | 'REJECT') {
  const r = await call(request, 'post', '/api/refdb/requests', AUTHOR, {
    domain: 'Body & Comfort',
    component: 'Access and locking',
    nameEn: `W5 e2e ${uniq()}`,
    nameKo,
    tshirt: 'S',
    asilRep: 'QM',
    sourceIds: ['S01'],
    swStack: 'Application',
    lifecycle: 'Commodity',
    techStack: 'Automotive',
  });
  const id = r.change.changeId as string;
  await call(request, 'post', `/api/refdb/changes/${id}/reviews`, REVIEWER, { opinion: decision === 'APPROVE' ? 'AGREE' : 'OPPOSE', comment: 'W5 e2e 검토 의견' });
  await call(request, 'post', `/api/refdb/changes/${id}/decision`, ADMIN, { decision, reason: decision === 'APPROVE' ? '근거 확인' : '기존 행과 중복' });
  return { changeId: id, refId: r.ref.refId as string };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('① 관리자 — 발행 미리 보기(승인 + 반려 → 폐기·알림·품질)와 미리 채운 메모로 발행, 출처 점검 개정 → 영향 행', async ({ page, request }) => {
  const ok = await decidedAdd(request, `W5 승인 행 ${uniq()}`, 'APPROVE');
  const no = await decidedAdd(request, `W5 반려 행 ${uniq()}`, 'REJECT');
  await as(page, 'steward');
  await page.goto('/master/feature-db/changes');
  const preview = page.getByTestId('ref-publish-preview');
  await expect(preview.locator(`[data-publish-change="${ok.changeId}"]`)).toBeVisible();
  // 회귀: 발행 칸이 승인 수만 말했다 — 반려 → 폐기도 같이 묶인다
  await expect(preview.locator(`[data-publish-retire="${no.refId}"]`)).toContainText('기존 행과 중복');
  await expect(preview.getByRole('group', { name: '품질 지표 변화' })).toContainText('→');
  const memo = page.getByRole('textbox', { name: /발행 메모/ });
  await expect(memo).toHaveValue(new RegExp(`발행 — .*${ok.changeId}`));
  const button = page.getByRole('button', { name: /발행 \(\d+건\)/ });
  await expect(button).toBeEnabled();
  await memo.fill('');
  await expect(button).toBeDisabled(); // 메모 필수
  await memo.fill('W5 e2e 발행 — 승인·반려 정리');
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: '발행했습니다' })).toBeVisible();
  // 발행 버전 표 — 메모와 발행자가 1366에서도 보인다
  await page.setViewportSize({ width: 1366, height: 900 });
  const rel = page.getByRole('table', { name: 'Feature DB 발행 버전' });
  await expect(rel.locator('[data-release-note]').filter({ hasText: 'W5 e2e 발행' })).toBeVisible();
  await expect(rel.getByRole('columnheader', { name: '발행자' })).toBeVisible();
  // 승인 행은 발행됨, 반려 행은 폐기
  expect((await call(request, 'get', `/api/refdb/refs/${no.refId}`, {})).ref.status).toBe('RETIRED');

  // 출처 점검 — 다음 점검일 없는 출처 경고, 개정 있음 → 이 출처를 쓰는 행 목록
  await page.goto('/master/feature-db?tab=sources');
  const panel = page.getByTestId('ref-sources');
  await expect(panel.locator('[data-no-next-review]')).toContainText('다음 점검일이 없는 출처');
  await panel.getByLabel('S01 점검 기록에 넣기').check();
  await page.getByRole('radio', { name: '개정 있음' }).click();
  await page.getByRole('textbox', { name: '점검 메모' }).fill('W5 e2e 개정판 확인');
  await page.getByRole('button', { name: '점검 기록 남기기' }).click();
  const go = page.getByRole('link', { name: /영향 행 변경 요청 만들기/ });
  await expect(go).toHaveAttribute('href', '/master/feature-db?source=S01');
  await go.click();
  await expect(page.locator('[data-source-filter="S01"]')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Feature DB 기준 행' }).locator('tbody tr').first()).toBeVisible();
  expect(await bodyCodes(page)).toEqual([]);
});

test('② 감사 — 변경 요청 하나를 한 패널에서 추적하고 감사 화면(앞부분 검색)으로 잇는다', async ({ page, request }) => {
  const cr = await decidedAdd(request, `W5 감사 추적 ${uniq()}`, 'APPROVE');
  await as(page, 'viewer');
  await page.goto(`/master/feature-db/changes/${cr.changeId}`);
  const trail = page.getByTestId('cr-audit-trail');
  await expect(trail.locator('li')).toHaveCount(3);
  await expect(trail.locator('li').nth(0)).toHaveAttribute('data-stage', 'REQUEST');
  await expect(trail.locator('li').nth(2)).toHaveAttribute('data-stage', 'DECIDE');
  await expect(trail).toContainText('Feature DB 승인·반려');
  await expect(trail).not.toContainText(/REFDB_|usr-/);
  await expect(page.locator('#main')).toContainText('결정 시각');
  await page.getByRole('link', { name: /감사 화면에서 보기/ }).click();
  await expect(page).toHaveURL(new RegExp(`/audit\\?prefix=${cr.changeId}`));
  const table = page.getByRole('table', { name: '감사 이력' });
  await expect(table.locator('[data-action="REFDB_CHANGE_DECIDE"]')).toHaveText('Feature DB 승인·반려');
  await expect(table.locator('[data-audit-change]').first()).toBeVisible();
  // 앞부분만 넣어도 찾는다
  await page.getByRole('searchbox', { name: '대상 (앞부분)' }).fill(cr.changeId.slice(0, 7));
  await page.getByRole('searchbox', { name: '대상 (앞부분)' }).press('Enter');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  // 체인 카드 — 마지막 검증 시각·고정점 상태·다시 검증
  const card = page.getByRole('region', { name: '해시 체인 검증' });
  await expect(card.locator('[data-chain-checked]')).not.toHaveText('—');
  await expect(card.locator('[data-anchor]')).toBeVisible();
  await card.getByRole('button', { name: '다시 검증' }).click();
  expect(await bodyCodes(page)).toEqual([]);
});

test('③ 법무·구매·개인정보보호 — 요청함 건에 의견을 남기면 요청 부서 홈과 감사에 보인다', async ({ page, request }) => {
  for (const [dept, opinion] of [
    ['DEP-LEG', '보완'],
    ['DEP-PUR', '동의'],
    ['DEP-DPO', '반대'],
  ] as const) {
    await as(page, 'viewer', dept);
    await page.goto('/');
    const home = page.locator('[data-workspace-home="portal"]');
    await expect(home).toBeVisible();
    const inbox = home.getByRole('table', { name: '의견 요청함' });
    const first = inbox.locator('a[data-consult]').first();
    await expect(first).toBeVisible();
    await expect(home).not.toContainText(JARGON);
    const id = (await first.getAttribute('data-consult'))!;
    if (dept === 'DEP-PUR') await expect(home).toContainText('협력사 납품 SW'); // 구매 요청함 — 협력사 변경 영향(P5-2)
    await first.click();
    // 흐름도가 아니라 '검토할 것 한 장'
    await expect(page).toHaveURL(new RegExp(`/consults/${id}$`));
    await expect(page.locator(`[data-consult-sheet="${id}"]`)).toBeVisible();
    await expect(page.locator('#main')).not.toContainText(JARGON);
    await page.getByRole('radio', { name: opinion }).click();
    const memo = `W5 e2e ${dept} 의견 ${uniq()}`;
    await page.getByRole('textbox', { name: /메모/ }).fill(memo);
    await page.getByRole('button', { name: '의견 보내기' }).click();
    await expect(page.getByRole('status').filter({ hasText: '의견을 보냈습니다' })).toBeVisible();
    const c = (await call(request, 'get', `/api/consultations/${id}`, {})).consultation;
    expect(c.opinions.at(-1)).toMatchObject({ memo, department: dept });
    // 요청한 부서의 '보낸 협의' 목록에 같은 의견이 보인다
    const sentBy = (await call(request, 'get', `/api/consultations?from=${c.fromDept}`, {})).items.find((x: { consultId: string }) => x.consultId === id);
    expect(sentBy.opinions.at(-1).memo).toBe(memo);
    const audit = (await call(request, 'get', `/api/audit?target=${id}&action=CONSULT_OPINION`, {})).items;
    expect(audit[0]).toMatchObject({ action: 'CONSULT_OPINION', result: 'ALLOWED' });
    expect(await bodyCodes(page)).toEqual([]);
  }
  // 법규인증팀(요청 부서) 홈에 보낸 협의와 받은 의견이 보인다
  await as(page, 'steward', 'DEP-HOM');
  await page.goto('/');
  const sent = page.getByRole('region', { name: '보낸 협의 요청' });
  await expect(sent).toBeVisible();
  await expect(sent.locator('li[data-status="ANSWERED"]').first()).toBeVisible();
});
