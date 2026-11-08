// Feature DB(기준 기능) 끝단 흐름 — 실제 백엔드(메모리 DB·v0.81 시드 + Feature DB v1.3)와 v2 화면(30-95 §6·§8).
//   (a) 검색 → 대표·포함 고르기 → 2단계 '기준값'/'수정됨' → ASIL 사유 → 등록 → 상세 '기준 행' 탭
//   (b) 추가 요청 → 요청 중 행이 대표 → 등록 → 정의 승인 막힘 → 도메인 검토(구성 승인) → 승인·발행(PLM 기준정보) → 막힘 풀림
//   (c) 같은 범위 같은 대표 행 409 → 사유 → 등록 · (d) 폐기 행은 고를 수 없음·폐기 예정 안내 · (e) axe WCAG 2.2 AA
// 발행 버전·폐기 행이 다른 시험에 영향을 주므로 이 파일의 시험은 한 작업자에서 차례로 돈다(실패해도 다음 시험은 돈다).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { propose as P } from '../../frontend/src/copy/propose';
import { refChangeDetail as D, refChanges as C, refDetail as RD } from '../../frontend/src/copy/refdb';
import { openRefPicker, pickPrimaryRef, submitProposedFeature, REF } from './refdb';
import { recordAnalysisApi } from './analysis';
import { settle } from './settle';

test.describe.configure({ mode: 'default' });

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const AUTHOR = H('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = H('usr-approver', 'DOMAIN_REVIEWER');
const STEWARD = H('usr-steward', 'REFDB_ADMIN');
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

/** 역할 바꾸기 — 같은 탭에서 다음 화면부터 그 역할(fp.state.v2) */
async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function api<T = any>(request: APIRequestContext, method: 'get' | 'post', path: string, headers: Record<string, string>, data?: unknown, code = method === 'get' ? 200 : 201): Promise<T> {
  const r = method === 'get' ? await request.get(`${API}${path}`, { headers }) : await request.post(`${API}${path}`, { headers, data });
  expect(r.status(), `${method.toUpperCase()} ${path}: ${await r.text()}`).toBe(code);
  return r.json() as Promise<T>;
}

/** 다음 발행 버전 — v1.3 → v1.4 (지금 발행 버전에서 부 번호 + 1) */
async function nextRelease(request: APIRequestContext) {
  const { items } = await api<{ items: { release: string }[] }>(request, 'get', '/api/refdb/releases', AUTHOR);
  const [maj, min] = items.at(-1)!.release.replace(/^v/, '').split('.').map(Number);
  return `v${maj}.${min + 1}`;
}

/** 정의 승인 직전까지 — 구현 연결 + 안전 분류 확정 + G1~G3 PASS(남는 막힘은 기준 행 연결뿐) */
async function readyForApproval(request: APIRequestContext, featureId: string, ver: string) {
  const base = `/api/features/${featureId}/versions/${ver}`;
  const p = await request.patch(`${API}${base}`, { headers: AUTHOR, data: { functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] } });
  expect(p.status(), await p.text()).toBe(200);
  await api(request, 'post', `${base}/safety/confirm`, H('usr-safety', 'SAFETY_OFFICER'), { reason: 'HARA 검토 완료' });
  await recordAnalysisApi(request, featureId, ver); // G2 PASS 근거 — HARA·TARA(P3-3)
  for (const gate of ['G1', 'G2', 'G3']) await api(request, 'post', `${base}/gates`, H('usr-quality', 'GATE_JUDGE'), { gate, inputResult: 'PASS', rationale: `${gate} 확인`, evidenceRef: `EV-${gate}` });
}

const featureUrl = /\/features\/(FEAT-\d+)\/(0\.1\.0)/;

async function axeClean(page: Page, label: string) {
  // 서랍까지(axe는 페이지 전체를 본다) 로딩이 끝나야 하고, 시간 초과는 실패다 — 오류 상자는 본문에서 0
  await settle(page, { scope: 'body', errors: '#main' });
  // 열리는 서랍·전환 애니메이션(유한)이 끝난 화면을 본다 — 무한 반복(로딩 점 등)은 기다리지 않는다
  // hygiene-ok: 취소된 애니메이션의 finished는 거부로 끝난다 — 시간 초과를 삼키는 대기가 아니라 '끝남'을 같은 값으로 받는 것
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const detail = bad.map((v) => `${v.id} ×${v.nodes.length}: ${v.help}\n    ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join('\n    ')}`).join('\n');
  expect(bad.reduce((n, v) => n + v.nodes.length, 0), `${label}\n${detail}`).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/_design');
  await asRole(page, 'author');
});

test('(a) 검색 AVH → 대표 + 포함 → 2단계 기준값·수정됨 → ASIL 변경 사유 → 등록 → 상세 기준 행 탭에 둘 다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tag = uniq();
  await page.goto('/feature/propose');
  await openRefPicker(page);
  await page.locator('input[name="refSearch"]').fill('AVH');
  await page.getByRole('button', { name: P.primaryLabel(REF.avh) }).click();
  await page.locator('input[name="refSearch"]').fill('경사로 밀림');
  await page.getByRole('button', { name: P.includeLabel('CH-BRK-006') }).click();
  await expect(page.locator(`[data-ref-chosen="${REF.avh}"]`)).toHaveAttribute('data-role', 'PRIMARY');
  await expect(page.locator('[data-ref-chosen="CH-BRK-006"]')).toHaveAttribute('data-role', 'INCLUDED');
  // 대표 행 컴포넌트의 세부기능 후보(읽기 전용)
  await expect(page.getByTestId('ref-subfunctions').getByRole('heading', { name: P.subfunctionsFor('Brake control (ESC/ABS)') })).toBeVisible();
  await page.locator('[data-ui="refPickNext"]').click();

  // 2단계 — 대표 행으로 미리 채움, 기준값 표시
  const name = page.locator('input[name="name"]');
  await expect(name).toHaveValue('오토 홀드');
  const nameField = page.locator('.ds-field').filter({ has: name });
  await expect(nameField.locator('[data-ref-mark]')).toHaveText(P.markBase);
  await expect(page.locator('select[name="asil"]')).toHaveValue('B');
  await name.fill(`오토 홀드 원격 해제 ${tag}`);
  await expect(nameField.locator('[data-ref-mark]')).toHaveText(P.markEdited);
  await page.locator('input[name="trim"]').fill(`E2E ${tag}`);
  await page.locator('input[name="ownerId"]').fill('Chassis Control Team');

  // 대표 ASIL(B)과 다르게 하면 사유가 필수
  const submit = page.locator('[data-ui="reviewFeature"]');
  await expect(submit).toBeEnabled();
  await page.locator('select[name="asil"]').selectOption('C');
  await expect(submit).toBeDisabled();
  await expect(page.getByText(P.asilReasonWhy).first()).toBeVisible();
  await page.locator('textarea[name="asilDeviation"]').fill('원격 해제 경로가 추가되어 상향');
  await expect(submit).toBeEnabled();
  await submitProposedFeature(page);

  await expect(page).toHaveURL(featureUrl);
  const [, id, ver] = page.url().match(featureUrl)!;
  await page.goto(`/features/${id}/${ver}?tab=refs`);
  const table = page.getByRole('table', { name: '연결된 기준 행' });
  await expect(table.getByRole('row').filter({ hasText: REF.avh })).toContainText(P.role.PRIMARY);
  await expect(table.getByRole('row').filter({ hasText: 'CH-BRK-006' })).toContainText(P.role.INCLUDED);
  await expect(table).toContainText('오토 홀드');
  await expect(page.getByTestId('ref-blocks-approval')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('(b) 추가 요청 → 요청 중 행을 대표로 등록 → 정의 승인 막힘 → 도메인 검토 → 승인·발행 → 막힘 풀림', async ({ page, request }) => {
  // 역할 셋이 화면 여러 개를 차례로 밟는다 — 기본 제한 시간의 세 배
  test.slow();
  const tag = uniq();
  const nameKo = `원격 트렁크 자동 닫힘 ${tag}`;
  await page.goto('/feature/propose');
  await openRefPicker(page);
  await page.getByRole('button', { name: P.requestNew }).click();
  const dlg = page.getByRole('dialog', { name: P.request.title, exact: true });
  await dlg.locator('select[name="domain"]').selectOption('Body & Comfort');
  const component = await dlg.locator('select[name="component"] option').nth(1).getAttribute('value');
  await dlg.locator('select[name="component"]').selectOption(component!);
  await dlg.locator('input[name="nameKo"]').fill(nameKo);
  await dlg.locator('input[name="nameEn"]').fill(`Remote trunk auto close ${tag}`);
  await dlg.locator('select[name="tshirt"]').selectOption('S');
  await dlg.locator('select[name="asilRep"]').selectOption('QM');
  // 출처 ID가 있어야 관리자가 승인할 수 있다(등록 기준 REQUIRED_INFO) — 출처 표의 S01
  await dlg.locator('input[name="sourceIds"]').fill('S01');
  await dlg.locator('textarea[name="basisNote"]').fill('사내 트렁크 사양서 2.1절');
  await dlg.locator('[data-ui="requestRefAdd"]').click();
  await expect(dlg).toHaveCount(0);

  // 서버가 정식 ID를 바로 준 요청 중 행이 대표
  const chosen = page.locator('[data-ref-chosen][data-role="PRIMARY"]');
  await expect(chosen).toContainText('요청 중');
  const refId = (await chosen.getAttribute('data-ref-chosen'))!;
  expect(refId).toMatch(/^BC-[A-Z0-9]{2,4}-\d{3}$/);
  await expect(page.getByTestId('ref-request-notice')).toContainText(refId);

  await page.locator('[data-ui="refPickNext"]').click();
  await expect(page.locator('input[name="name"]')).toHaveValue(nameKo);
  await page.locator('input[name="trim"]').fill(`E2E ${tag}`);
  await page.locator('input[name="ownerId"]').fill('Body Control Team');
  await page.locator('input[name="requirementIds"]').fill('REQ-E2E-REFDB');
  await submitProposedFeature(page);
  // 요청 중 행 연결은 등록하되 서버 안내(warnings)를 먼저 보인다
  const warnings = page.getByTestId('propose-warnings');
  await expect(warnings.locator('[data-warning="REF_STATUS"]')).toContainText(refId);
  await warnings.getByRole('button', { name: P.openDetail }).click();
  await expect(page).toHaveURL(featureUrl);
  const [, id, ver] = page.url().match(featureUrl)!;

  // 정의 승인 막힘 — Gate·안전 분류를 채워도 요청 중 행이 남는다(REFDB_LINK_BLOCKED)
  await readyForApproval(request, id, ver);
  const blocked = `기준 행 ${refId}이(가) 요청 중 상태입니다`;
  const detail = await api<{ transitions: { to: string; blockers: { code: string; message: string }[] }[] }>(request, 'get', `/api/features/${id}/versions/${ver}`, AUTHOR);
  // 역할·직무 분리·사유는 승인하는 사람이 채우는 조건 — 그 밖의 막힘은 기준 행 연결 하나
  const hard = (bs: { code: string }[]) => bs.map((b) => b.code).filter((c) => !['ROLE', 'REASON_REQUIRED', 'SEPARATION_OF_DUTY'].includes(c));
  expect(hard(detail.transitions.find((t) => t.to === 'APPROVED')!.blockers)).toEqual(['REFDB_LINK_BLOCKED']);
  await page.goto(`/features/${id}/${ver}?tab=refs`);
  await expect(page.getByTestId('ref-blocks-approval')).toBeVisible();
  await expect(page.locator('#main')).toContainText(blocked);

  // 도메인 검토 — 구성 승인(DOMAIN_REVIEWER)
  const { items } = await api<{ items: { changeId: string; status: string }[] }>(request, 'get', `/api/refdb/changes?refId=${refId}`, AUTHOR);
  const changeId = items[0].changeId;
  await asRole(page, 'approver');
  await page.goto(`/master/feature-db/changes/${changeId}`);
  await page.getByLabel(D.comment).fill('분류·기능명 확인 — 동의');
  await page.getByRole('button', { name: D.submitReview }).click();
  await expect(page.locator('[data-opinion="AGREE"]')).toContainText('분류·기능명 확인');
  await expect(page.getByRole('button', { name: D.approve })).toHaveCount(0);

  // 승인·발행 — PLM 기준정보(REFDB_ADMIN)
  await asRole(page, 'steward');
  await page.goto(`/master/feature-db/changes/${changeId}`);
  await page.getByLabel(D.decideReason).fill('근거 메모 확인');
  const approval = page.waitForResponse((response) => response.url().endsWith(`/api/refdb/changes/${changeId}/decision`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: D.approve }).click();
  expect((await approval).status()).toBe(201);
  await expect(page.locator('#main')).toContainText('발행 대기');
  const release = await nextRelease(request);
  await page.goto('/master/feature-db/changes');
  await expect(page.locator(`[data-publish-change="${changeId}"]`)).toBeVisible();
  const publish = page.locator('[data-ui="publishRefRelease"]');
  await expect(publish).toBeEnabled();
  await expect(publish).toContainText(release);
  await publish.click();
  await expect(page.getByRole('status').filter({ hasText: C.published(release) })).toBeVisible();
  const change = await api<{ change: { status: string; release: string } }>(request, 'get', `/api/refdb/changes/${changeId}`, AUTHOR);
  expect(change.change).toMatchObject({ status: 'PUBLISHED', release });

  // Feature 정의 승인이 더는 막히지 않는다 — 구성 승인이 승인한다
  const after = await api<{ transitions: { to: string; blockers: { code: string }[] }[] }>(request, 'get', `/api/features/${id}/versions/${ver}`, AUTHOR);
  expect(hard(after.transitions.find((t) => t.to === 'APPROVED')!.blockers)).toEqual([]);
  await asRole(page, 'approver');
  await page.goto(`/features/${id}/${ver}?tab=refs`);
  await expect(page.getByTestId('ref-blocks-approval')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText(blocked);
  await page.getByRole('button', { name: 'APPROVED로 전이' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.locator('textarea').fill('Feature DB 발행 뒤 정의 승인');
  await drawer.getByRole('button', { name: '실행', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const approved = await api<{ feature: { lifecycle: string } }>(request, 'get', `/api/features/${id}/versions/${ver}`, AUTHOR);
  expect(['APPROVED', 'DEVELOPING']).toContain(approved.feature.lifecycle);
});

test('(b2) 출처 ID 없이 근거 메모만 있는 추가 요청도 승인·발행된다 — 기준 행은 검토 필요로', async ({ page, request }) => {
  const tag = uniq();
  const { ref, change } = await api<{ ref: { refId: string; status: string }; change: { changeId: string } }>(request, 'post', '/api/refdb/requests', AUTHOR, {
    domain: 'Body & Comfort',
    component: 'Access and locking',
    nameEn: `Welcome light follow ${tag}`,
    nameKo: `웰컴 라이트 따라 켜짐 ${tag}`,
    tshirt: 'XS',
    asilRep: 'QM',
    sourceIds: [],
    basisNote: '사내 조명 사양서 4.3절',
  });
  expect(ref.status).toBe('PENDING');
  await api(request, 'post', `/api/refdb/changes/${change.changeId}/reviews`, REVIEWER, { opinion: 'AGREE', comment: '근거 메모 확인' });
  // 근거 메모가 필수 정보(출처)를 대신한다 — 1차 출처 없음은 보완 필요(승인은 된다)
  await api(request, 'post', `/api/refdb/changes/${change.changeId}/decision`, STEWARD, { decision: 'APPROVE', reason: '근거 메모로 승인' });
  await api(request, 'post', '/api/refdb/releases', STEWARD, { changeIds: [change.changeId], note: 'e2e 근거 메모 행' });
  await page.goto(`/master/feature-db/${ref.refId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('웰컴 라이트 따라 켜짐');
  await expect(page.locator('#main [data-ref-status="REVIEW"]').first()).toBeVisible();
  await expect(page.locator('[data-policy-hint]')).toContainText('2차 자료');
});

test('(c) 같은 국가·차종·트림에 같은 대표 기준 행 — 409 안내 → 사유를 적고 확인하면 등록', async ({ page }) => {
  // FEAT-00145(스마트 크루즈 컨트롤, KR·NX4 PE·Premium)의 대표 기준 행 AD-LON-002
  await page.goto('/feature/propose');
  await pickPrimaryRef(page, 'AD-LON-002', 'AD-LON-002');
  await page.locator('input[name="name"]').fill(`ACC 하드웨어 변형 ${uniq()}`);
  await page.locator('input[name="ownerId"]').fill('ADAS기획팀');
  await submitProposedFeature(page);
  const dup = page.getByTestId('propose-duplicate');
  await expect(dup).toContainText('AD-LON-002');
  await expect(dup).toContainText('FEAT-00145');
  const confirm = dup.locator('[data-ui="createFeatureConfirmDuplicate"]');
  await expect(confirm).toBeDisabled();
  await dup.locator('textarea[name="duplicateReason"]').fill('레이더 공급사가 다른 하드웨어 변형');
  await confirm.click();
  // 확인한 중복은 서버 안내(REF_DUPLICATE_CONFIRMED)로 남는다
  const warnings = page.getByTestId('propose-warnings');
  await expect(warnings.locator('[data-warning="REF_DUPLICATE_CONFIRMED"]')).toContainText('레이더 공급사가 다른 하드웨어 변형');
  await warnings.getByRole('button', { name: P.openDetail }).click();
  await expect(page).toHaveURL(featureUrl);
});

test('(d) 폐기 행은 고를 수 없고(변경 요청 → 발행으로 폐기), 폐기 예정은 안내 뒤 고른다', async ({ page, request }) => {
  // 폐기 — 쓰지 않는 활성 행(공사 구간 인식)을 폐기 요청 → 검토 → 승인 → 발행
  const target = 'AD-ADS-024';
  const cur = await api<{ ref: { status: string } }>(request, 'get', `/api/refdb/refs/${target}`, AUTHOR);
  if (cur.ref.status !== 'RETIRED') {
    const c = await api<{ changeId: string }>(request, 'post', '/api/refdb/changes', AUTHOR, { kind: 'RETIRE', refId: target, after: { status: 'RETIRED' }, reason: 'e2e — 다른 행으로 통합' });
    await api(request, 'post', `/api/refdb/changes/${c.changeId}/reviews`, REVIEWER, { opinion: 'AGREE', comment: '통합 확인' });
    await api(request, 'post', `/api/refdb/changes/${c.changeId}/decision`, STEWARD, { decision: 'APPROVE', reason: '통합 승인' }, 201);
    await api(request, 'post', '/api/refdb/releases', STEWARD, { changeIds: [c.changeId], note: 'e2e 폐기' });
  }
  await page.goto('/feature/propose');
  await openRefPicker(page);
  await page.locator('input[name="refSearch"]').fill(target);
  const retired = page.getByRole('button', { name: P.primaryLabel(target) });
  await expect(retired).toBeDisabled();
  await expect(page.locator('.propose-result, tr').filter({ hasText: target }).first()).toContainText(P.retiredWhy);
  await expect(page.getByRole('button', { name: P.includeLabel(target) })).toHaveCount(0);

  // 폐기 예정(PL-CP-023 LdCom, 대체 행 없음) — 안내를 보이고, '그래도 선택'을 눌러야 고른다
  await page.locator('input[name="refSearch"]').fill('PL-CP-023');
  await page.getByRole('button', { name: P.primaryLabel('PL-CP-023') }).click();
  const dep = page.getByTestId('ref-deprecated');
  await expect(dep).toContainText(P.deprecatedTitle('PL-CP-023'));
  await expect(dep).toContainText(P.deprecatedBody(null));
  await expect(page.locator('[data-ref-chosen="PL-CP-023"]')).toHaveCount(0);
  await dep.getByRole('button', { name: P.chooseAnyway }).click();
  await expect(page.locator('[data-ref-chosen="PL-CP-023"]')).toHaveAttribute('data-role', 'PRIMARY');
  await expect(page.locator('[data-ref-chosen="PL-CP-023"]')).toContainText(P.deprecatedBody(null));
});

test('(e) axe WCAG 2.2 AA — Feature DB 목록·상세·변경 요청·제안 1·2단계·추가 요청 서랍 serious/critical 0', async ({ page, request }) => {
  test.slow(); // 화면 일곱 개를 차례로 검사한다
  // 변경 요청 상세에 볼 요청 하나(수정 요청 — 검토 전)
  const open = await api<{ items: { changeId: string; status: string }[] }>(request, 'get', '/api/refdb/changes?refId=AD-ADS-026', AUTHOR);
  const changeId =
    open.items.find((c) => c.status === 'REVIEW' || c.status === 'DRAFT')?.changeId ??
    (await api<{ changeId: string }>(request, 'post', '/api/refdb/changes', AUTHOR, { kind: 'MODIFY', refId: 'AD-ADS-026', after: { remark: 'e2e 접근성 점검용 수정 요청' }, reason: 'e2e — 비고 보완' })).changeId;

  for (const [url, label] of [
    ['/master/feature-db', 'Feature DB 목록'],
    ['/master/feature-db/CH-BRK-009', '기준 행 상세'],
    ['/master/feature-db/changes', '변경 요청 목록'],
    [`/master/feature-db/changes/${changeId}`, '변경 요청 상세'],
  ] as const) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await axeClean(page, label);
  }
  // 관리자 화면(승인·발행 칸)도
  await asRole(page, 'steward');
  await page.goto(`/master/feature-db/changes/${changeId}`);
  await expect(page.getByRole('button', { name: D.approve })).toBeVisible();
  await axeClean(page, '변경 요청 상세(관리자)');

  await asRole(page, 'author');
  await page.goto('/feature/propose');
  await openRefPicker(page);
  await page.locator('input[name="refSearch"]').fill('AVH');
  await expect(page.getByRole('button', { name: P.primaryLabel(REF.avh) })).toBeVisible();
  await axeClean(page, '제안 1단계');
  await page.getByRole('button', { name: P.requestNew }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await axeClean(page, '추가 요청 서랍');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: P.steps.pick, exact: true })).toBeVisible();
  await page.getByRole('button', { name: P.primaryLabel(REF.avh) }).click();
  await page.locator('[data-ui="refPickNext"]').click();
  await expect(page.locator('input[name="name"]')).toBeVisible();
  await axeClean(page, '제안 2단계');
});

test('(f) 벤치마크 €는 DB 관리자(PLM 기준정보)에게만 — 화면은 역할마다 따로 읽는다', async ({ page, request }) => {
  // API — 같은 GET이 역할마다 다르다(personal): 관리자는 금액 키가 있고, 작성자는 키 자체가 없다
  const admin = await api<{ ref: Record<string, unknown> }>(request, 'get', `/api/refdb/refs/${REF.avh}`, STEWARD);
  const author = await api<{ ref: Record<string, unknown> }>(request, 'get', `/api/refdb/refs/${REF.avh}`, AUTHOR);
  expect('benchmarkEur' in admin.ref).toBe(true);
  expect('benchmarkEur' in author.ref).toBe(false);
  await asRole(page, 'steward');
  await page.goto(`/master/feature-db/${REF.avh}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('오토 홀드');
  await expect(page.getByRole('region', { name: RD.benchmark })).toBeVisible();
  // 같은 탭에서 작성자로 — 캐시에 관리자 응답이 남아 금액이 보이면 안 된다
  await asRole(page, 'author');
  await page.goto(`/master/feature-db/${REF.avh}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('오토 홀드');
  await settle(page);
  await expect(page.getByRole('region', { name: RD.benchmark })).toHaveCount(0);
});

/** 진행 중인 변경 요청이 없는 기준 행 — 한 행에는 처리 중인 요청이 하나만 있을 수 있다(같은 백엔드로 다시 돌려도 되게) */
async function freeRef(request: APIRequestContext, ids: readonly string[]) {
  for (const refId of ids) {
    const { items } = await api<{ items: { status: string }[] }>(request, 'get', `/api/refdb/changes?refId=${refId}`, AUTHOR);
    if (!items.some((c) => ['DRAFT', 'REVIEW', 'APPROVED'].includes(c.status))) return refId;
  }
  throw new Error(`진행 중인 변경 요청이 없는 기준 행이 없습니다: ${ids.join(', ')}`);
}

test('(g) 수정 요청 서랍(MODIFY) → 자동 점검 → 변경 요청 상세, 요청자 본인은 검토가 이유와 함께 막힌다', async ({ page, request }) => {
  const target = await freeRef(request, ['AD-ADS-013', 'AD-ADS-014', 'AD-ADS-015', 'AD-ADS-016', 'AD-ADS-017', 'AD-ADS-018']);
  await page.goto(`/master/feature-db/${target}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '변경 요청' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('바꾼 값이 없습니다')).toBeVisible();
  await dlg.getByLabel('비고').fill(`e2e 수정 요청 ${uniq()}`);
  await dlg.getByLabel('요청 사유').fill('비고 보완 — e2e');
  await dlg.getByRole('button', { name: '변경 요청 보내기' }).click();
  await expect(dlg.getByRole('status')).toContainText('을(를) 만들었습니다');
  await dlg.getByRole('link', { name: '변경 요청 열기' }).click();
  await expect(page).toHaveURL(/\/master\/feature-db\/changes\/CR-/);
  await expect(page.locator('.ds-diff')).toContainText('비고');
  await settle(page);

  // 도메인 검토자가 직접 낸 요청 — 같은 계정은 자기 요청을 검토할 수 없다(서버 직무 분리와 같은 문장, 코드 없음)
  const mine = await freeRef(request, ['AD-ADS-023', 'AD-ADS-022', 'AD-ADS-012', 'AD-ADS-011', 'AD-ADS-010', 'AD-ADS-009']);
  const own = await api<{ changeId: string }>(request, 'post', '/api/refdb/changes', REVIEWER, { kind: 'MODIFY', refId: mine, after: { remark: `e2e 검토자 본인 요청 ${uniq()}` }, reason: 'e2e — 본인 검토 막힘' });
  await asRole(page, 'approver');
  await page.goto(`/master/feature-db/changes/${own.changeId}`);
  const send = page.getByRole('button', { name: D.submitReview });
  await expect(send).toBeDisabled();
  await expect(page.locator('#main .ds-btn-why__text').filter({ hasText: '변경 요청자는 자기 요청을 검토할 수 없습니다' })).toBeVisible();
  await expect(page.locator('#main')).not.toContainText(/\bSOD-\d/);
});
