import { openRefPicker } from '../tests/refdb';
// 정적 데모 — 모든 메뉴·하위 화면이 스냅샷만으로 열린다: 요청한 /api-snapshot/ 파일은 모두 200·JSON이어야 한다.
// 빠진 파일은 SPA 대체 응답(index.html)으로 와서 화면이 오류가 된다 — 그 URL을 모아 실패 메시지로 낸다(tools/snapshot-api.ts에 추가할 목록).
// 탭마다 본문 오류 상자([data-state=error])도 0이어야 한다(하네스 리뷰 H10 — 파일은 있어도 화면이 오류일 수 있다).
// 탭마다 빈 상태도 0이어야 한다(2026-11-05 사용자 규칙 — 공개 데모 어디에도 빈 상태 금지, 문구로 때우지 말고 스냅샷으로 채운다):
//   빈 상자([data-state=empty], 숨은 빈 목록 포함)·빈 상태 문구(empty-copy.ts — 화면 문구 집합 그대로)·끝나지 않는 로딩.
//   안쪽 탭(탭 안의 탭)도 바깥 탭마다 모두 누른다. 데이터상 0이 정상인 안내만 ALLOW에 이유와 함께 둔다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { routeUrl, snapshotFile } from '@ff/contracts';
import { DRILLDOWNS, MENU_ENTRIES } from '../tests/menu';
import { EMPTY_PATTERN, EMPTY_PHRASES } from './empty-copy';

const targets = [...MENU_ENTRIES.map((m) => ({ title: m.title, url: m.menu })), ...DRILLDOWNS.map((d) => ({ title: d.title, url: d.url }))];

/** 요청한 스냅샷 중 없는 파일 모으기 — 빠진 파일은 SPA 대체 응답(index.html)으로 온다 */
function watch(page: Page) {
  const missing = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.includes('/api-snapshot/')) return;
    if (r.status() !== 200 || !(r.headers()['content-type'] ?? '').includes('json')) missing.add(decodeURIComponent(u.pathname.replace(/^.*\/api-snapshot\//, '')));
  });
  return { missing, errors };
}

/** 본문 오류 상자 0 — 화면 이름과 탭 이름을 실패 메시지에 */
async function noErrorBox(page: Page, where: string) {
  await expect(page.locator('#main [data-state="error"]'), `${where}: 본문에 오류 상자가 보인다`).toHaveCount(0);
}

/**
 * 빈 상태 허용 — [주소 정규식, 표식 정규식, 이유]. 데이터상 0이 정상인 안내만, 최소로.
 * 표식은 '종류 [패널 제목] 글자'(빈 상자·문구·로딩).
 */
type EmptyProof = (page: Page) => Promise<void>;
/** A normal zero is accepted only when the actual captured API confirms it.
 * Missing files, malformed responses, errors and loaders remain failures. */
const capturedZero = (name: string, arrays = ['items'], params: Record<string, string> = {}, query: Record<string, string> = {}): EmptyProof => async page => {
  const path = '/' + snapshotFile(routeUrl(name, params, query));
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  expect(response.headers()['content-type'], path).toContain('json');
  const body = await response.json();
  for (const field of arrays) {
    expect(Array.isArray(body[field]), `${path}.${field} must be an array`).toBe(true);
    expect(body[field], `${path}.${field}: a populated source must never be waived`).toHaveLength(0);
  }
};
const capturedExperiment = (check: 'baseline' | 'samples' | 'draft'): EmptyProof => async page => {
  const id = (await page.locator('.ds-drawer').innerText()).match(/\bEXP-\d+\b/)?.[0];
  expect(id, 'the visible drawer must identify its actual experiment').toBeTruthy();
  const response = await page.request.get('/' + snapshotFile(routeUrl('experiment', { id: id! })));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('json');
  const data = await response.json();
  expect(data.experimentId).toBe(id);
  if (check === 'draft') {
    expect(data.status).toBe('DRAFT');
    expect(data.startedAt).toBeNull();
    expect(data.results).toBeNull();
  } else if (check === 'baseline') {
    expect(data.type).toBe('SHADOW');
    expect(data.results.fleet.comparisonStatus).toBe('NO_BASELINE');
    expect(data.results.fleet.deployedPolicyId).toBeNull();
    expect(data.results.fleet.comparableVehicles).toBe(0);
  } else {
    expect(data.results.verdict).toBe('INSUFFICIENT');
    expect(data.results.enough).toBe(false);
    expect(Math.min(data.results.sampleCounts.control, data.results.sampleCounts.treatment)).toBeLessThan(data.minSamples);
  }
};
const capturedUnknownImpact: EmptyProof = async page => {
  const drawer = page.locator('.ds-drawer');
  await expect(drawer).toContainText('판단 불가 — 확정 영향군이 아직 없습니다');
  const id = (await drawer.innerText()).match(/\bKILL-\d+\b/)?.[0];
  expect(id).toBeTruthy();
  const read = async (name: string, id: string) => {
    const response = await page.request.get('/' + snapshotFile(routeUrl(name, { id })));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('json');
    return response.json();
  };
  const kill = await read('killDetail', id!);
  const impact = await read('impactSet', kill.incidentId ?? kill.killId);
  expect(impact.accuracy.status).toBe('UNKNOWN');
  expect(impact.accuracy.value).toBeNull();
  expect(impact.confirmed).toBeNull();
};
const ALLOW: [RegExp, RegExp, string, RegExp?, EmptyProof?][] = [
  [/^\/audit\/oversight/, /겸직 계정이 없습니다/, '직무 분리 감사의 정상 결과 — 겸직 0건이 통과 기준이다(FFG-PLT-016)'],
  [/^\/feature\/propose/, /아직 고른 기준 행이 없습니다/, '등록 1단계의 입력 전 칸 — 사람이 기준 행을 고르기 전 상태(실서버 빈 화면 하네스와 같은 허용)'],
  [/^\/data\/workbench/, /저장한 조회가 없습니다|실행한 조회가 없습니다/, '이 브라우저·계정의 개인 목록 — 사람이 조회를 저장·실행하기 전 칸(스냅샷 데이터가 아니다)'],
  [/^\/fleet\/live$/, /^문구 \[배포·차단 이벤트\] 아직 이벤트가 없습니다$/, '접속 이후의 실시간 변경 전용 피드 — 과거 감사 이력과 구분한다', /정책 값 대조$/],
  [/^\/fleet\/map$/, /^문구 \[실시간 변경\] 아직 이벤트가 없습니다$/, '접속 이후의 실시간 변경 전용 피드 — 접속 직후 새 변경은 0건이다', /^\/fleet\/map$/],
  [/^\/ops\/telemetry$/, /^빈 상자 \[운영 데이터·이벤트\]/, '수동 스케줄러의 동결 원천에 차량 회신이 없다 — 회신을 만들어 적용 완료로 표시하지 않는다', /^(\/ops\/telemetry|\/ops\/telemetry › 회신 \(readback\)|\/ops\/telemetry › 지표·추적·이벤트 › 차량 회신)$/, capturedZero('readbacks')],
  [/^\/ops\/telemetry$/, /^빈 상자 \[운영 데이터·이벤트\]/, '수신하지 않은 차량 상태는 UNKNOWN — 원천 features/recent가 모두 0임을 확인한다', / › 상태 보고 v2$/, capturedZero('vehicleStatusView', ['features', 'recent'], { vin: 'ego-01' })],
  [/^\/fleet\/vehicles(?:\/ego-01)?$/, /^문구 \[상태 보고 v2 .* 받아들인 상태 보고가 없습니다 .*UNKNOWN\)/, '차량 적용 증거 없음은 비활성 판정이 아니다 — 원천 0과 UNKNOWN 안내를 함께 확인한다', / › 정책 게시본·수신 기록$/, capturedZero('vehicleStatusView', ['features', 'recent'], { vin: 'ego-01' })],
  [/^\/integration\/openfeature$/, /^빈 상자 \[OpenFeature 범위\]/, 'ego-01 내장 provider에 수집된 평가가 없다 — 서버 범위 표와 차량 관측을 구분한다', /^(\/integration\/openfeature|\/integration\/openfeature › 차량 내장 provider \(OF-6\))$/, capturedZero('vehicleOpenFeature', ['items'], { vin: 'ego-01' })],
  [/^\/procurement\/sw-cost\/EST-0001$/, /^문구 .* 등록된 검토 건이 없습니다\.$/, '보존 대상 기존 초안은 아직 구매 검토를 시작하지 않았다 — 신규 산정과 독립 승인은 별도 업무 흐름에서 검증한다', / › 구매 검토$/, capturedZero('costReviews', ['items'], { estId: 'EST-0001' })],
  [/^\/policies\/POL-00001$/, /^문구 \[진행 중인 되돌리기\] (진행 중인 되돌리기 요청이 없습니다\.|요청이 없습니다\.)$/, '진행 중인 롤백 요청 0은 정상 — 요청·반려·실행은 별도 실제 업무 흐름으로 검증한다', undefined, capturedZero('rollbackRequests', ['items'], {}, { status: 'REQUESTED' })],
  [/^\/ops\/rollback$/, /^빈 상자 \[롤백 이력\]/, '아직 실행하지 않은 롤백의 이력은 0건 — 실제 실행 업무 흐름과 구분한다', /^\/ops\/rollback$/, capturedZero('rollbacks')],
  [/^\/experiments$/, /^문구 \[배포 정책과 후보 정책의 판단 비교\] 비교할 배포 정책이 없습니다\. 일치한 것으로 판정하지 않습니다\.$/, '비교 기준이 없는 음성 대조군 — 실제 원천 NO_BASELINE을 확인하고 일치 판정하지 않는다', / 행 \d+ 서랍$/, capturedExperiment('baseline')],
  [/^\/experiments$/, /^문구 \[(배포 정책과 후보 정책의 판단 비교)?\] 아직 결론을 낼 수 없습니다$/, '최소 표본 미달의 음성 대조군 — 실제 원천 INSUFFICIENT와 각 군 표본 수를 확인한다', / 행 \d+ 서랍$/, capturedExperiment('samples')],
  [/^\/experiments$/, /^문구 \[효과 추정\] 시작 전 — 결과가 없습니다$/, '실험 초안은 시작 전 결과가 없어야 한다 — 실제 DRAFT·미시작·결과null을 확인한다', / 행 \d+ 서랍$/, capturedExperiment('draft')],
  [/^\/ops\/kill$/, /^문구 \[KILL-\d+\] 아직 없습니다$/, '확정 영향군이 없는 안전 음성 대조군 — 실제 원천 정확도UNKNOWN·확정null과 전체 안내 문장을 함께 확인한다', / 행 \d+ 서랍$/, capturedUnknownImpact],
];

async function allowed(page: Page, url: string, mark: string, trail: string) {
  if (mark.startsWith('로딩 ')) return false;
  const rule = ALLOW.find(([u, m, , t]) => u.test(url) && m.test(mark) && (!t || t.test(trail)));
  if (!rule) return false;
  await rule[4]?.(page);
  test.info().annotations.push({ type: 'normal-zero', description: `${trail} — ${rule[2]}` });
  return true;
}

/** 다 그려진 범위(본문·팝오버)의 빈 상태 표식 */
async function emptyMarks(page: Page, scope: string): Promise<string[]> {
  return page.evaluate(
    ([scope, phrases, pattern]) => {
      const root = document.querySelector(scope) as HTMLElement | null;
      if (!root) return [];
      const vis = (e: Element) => (e as HTMLElement).checkVisibility?.() ?? !!(e as HTMLElement).offsetParent;
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const where = (e: Element) => {
        const p = e.closest('section, article, .ds-panel, aside, [role="dialog"], main');
        const h = p?.querySelector('h1, h2, h3, h4');
        return norm(h?.textContent ?? '').slice(0, 40);
      };
      const out: string[] = [];
      for (const e of root.querySelectorAll('[data-state="empty"]')) {
        if (!e.hasAttribute('data-empty-hidden') && !vis(e)) continue;
        out.push(`빈 상자 [${where(e.parentElement ?? e)}] ${norm(e.textContent ?? '').slice(0, 90) || '(숨은 빈 목록)'}`);
      }
      for (const e of root.querySelectorAll('[data-state="loading"]')) if (vis(e)) out.push(`로딩 [${where(e.parentElement ?? e)}]`);
      // 문구 — 보이는 글자(innerText)에서 찾고, 그 문구를 가진 가장 안쪽 요소로 위치를 적는다(빈 상자 안 문구는 위에서 셌다)
      const text = norm(root.innerText);
      const hits = phrases.filter((p) => text.includes(norm(p)));
      const m = text.match(new RegExp(pattern));
      if (m && !hits.some((h) => norm(h).includes(m[0]))) hits.push(m[0]);
      for (const h of hits) {
        const els = [...root.querySelectorAll('*')].filter((e) => vis(e) && norm(e.textContent ?? '').includes(norm(h)));
        const inner = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
        const shown = inner.filter((e) => !e.closest('[data-state="empty"]'));
        if (inner.length && !shown.length) continue;
        out.push(`문구 [${shown[0] ? where(shown[0]) : ''}] ${norm(h).slice(0, 90)}`);
      }
      return out;
    },
    [scope, EMPTY_PHRASES, EMPTY_PATTERN.source] as const,
  );
}

/**
 * 로딩이 끝나기를 기다린 뒤(10초 안에 끝나지 않으면 '로딩' 표식으로 남는다) 빈 상태 표식을 모은다.
 * 탭을 누른 직후에는 지연 모듈이 아직 그려지지 않아 로딩 0이 바로 맞을 수 있다 — 0이 세 번 이어질 때까지 본다.
 */
async function collectEmpty(page: Page, scope: string, where: string, into: string[]) {
  const loading = page.locator(`${scope} [data-state="loading"]`);
  for (let calm = 0, end = Date.now() + 10_000; calm < 3 && Date.now() < end; ) {
    calm = (await loading.count()) === 0 ? calm + 1 : 0;
    await page.waitForTimeout(200); // hygiene-ok: 로딩 0이 세 번 이어지는지 보는 조건 대기의 간격(상한 10초) — 못 끝나면 '로딩' 표식으로 실패에 남는다
  }
  const url = new URL(page.url()).pathname;
  for (const mark of await emptyMarks(page, scope)) if (!(await allowed(page, url, mark, where))) into.push(`${where} — ${mark}`);
}

/** 탭 묶음(role=tablist)에 깊이(바깥 탭 패널 수)별 표식을 붙이고 수를 센다 — 안쪽 탭은 바깥 탭마다 다시 센다 */
async function tagTabLists(page: Page, scope: string, depth: number): Promise<number> {
  return page.evaluate(
    ([scope, depth]) => {
      const root = document.querySelector(scope);
      if (!root) return 0;
      const depthOf = (l: Element) => {
        let d = 0;
        for (let e = l.parentElement; e; e = e.parentElement) if (e.getAttribute('role') === 'tabpanel') d++;
        return d;
      };
      const lists = [...root.querySelectorAll('[role="tablist"]')].filter((l) => depthOf(l) === depth);
      lists.forEach((l, i) => l.setAttribute('data-static-tl', `${depth}-${i}`));
      return lists.length;
    },
    [scope, depth] as const,
  );
}

/** 이 범위의 탭을 모두 누르고, 탭마다 오류 상자·빈 상태를 본다. 누른 탭의 패널 안 탭(안쪽 탭)도 차례로 */
async function visitTabs(page: Page, scope: string, depth: number, trail: string, empties: string[]) {
  if (depth > 3) return;
  const lists = await tagTabLists(page, scope, depth);
  for (let k = 0; k < lists; k++) {
    await tagTabLists(page, scope, depth);
    const n = await page.locator(`[data-static-tl="${depth}-${k}"] [role="tab"]`).count();
    for (let i = 0; i < n; i++) {
      await tagTabLists(page, scope, depth);
      const tab = page.locator(`[data-static-tl="${depth}-${k}"] [role="tab"]`).nth(i);
      if (!(await tab.isVisible())) continue;
      const label = `${trail} › ${((await tab.textContent()) ?? '').trim().slice(0, 30)}`;
      // 패널 ID는 누르기 전에 — 탭을 누르면 화면이 탭 묶음을 새로 그려 표시(data-static-tl)가 사라질 수 있다(활성화 판단, 통합 12단계)
      const panel = await tab.getAttribute('aria-controls');
      await tab.click();
      await page.waitForLoadState('networkidle');
      await noErrorBox(page, `${page.url()} 탭 ${label}`);
      await collectEmpty(page, '#main', label, empties);
      if (panel && (await page.locator(`[id="${panel}"]`).count())) await visitTabs(page, `[id="${panel}"]`, depth + 1, label, empties);
    }
  }
}

/** 화면이 뜬 뒤 탭을 모두 차례로 연다 — 탭마다 따로 조회하고, 탭마다 오류 상자·빈 상태가 없는지 본다 */
async function openAllTabs(page: Page) {
  // URL 전환 뒤 지연 모듈이 실제로 읽힐 때까지 기다린다. 이전 화면의 탭을 세면 사라진 탭을 누른다.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main h1').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await noErrorBox(page, page.url());
  const where = new URL(page.url()).pathname + new URL(page.url()).search;
  const empties: string[] = [];
  await collectEmpty(page, '#main', where, empties);
  await visitTabs(page, '#main', 0, where, empties);
  // 빈 상태는 모아서 한 번에 — 같은 시험의 스냅샷 누락 목록도 함께 보이게 soft
  expect.soft([...new Set(empties)], `빈 상태가 보인다 — 스냅샷 데이터로 채우거나, 데이터상 0이 정상이면 이유와 함께 ALLOW에`).toEqual([]);
}

for (const t of targets) {
  test(`정적 데모: ${t.title} (${t.url})`, async ({ page }) => {
    const { missing, errors } = watch(page);
    await page.goto(t.url);
    await openAllTabs(page);
    expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('정적 데모: 관측 Events 직접 진입은 이벤트 JSON 스냅샷과 표를 읽는다', async ({ page }) => {
  const { missing, errors } = watch(page);
  const snapshot = await page.request.get('/api-snapshot/events_limit_500_recent_1.json');
  expect(snapshot.status()).toBe(200);
  expect(snapshot.headers()['content-type']).toContain('json');
  const data = await snapshot.json();
  expect(Array.isArray(data.items)).toBe(true);
  expect(data.items.length).toBeGreaterThan(0);
  await page.goto('/ops/telemetry?tab=observability&observe=logs');
  await expect(page.getByRole('tab', { name: '지표·추적·이벤트', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Events', exact: true })).toHaveAttribute('aria-selected', 'true');
  const table = page.getByRole('table', { name: '이벤트 기록', exact: true });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toContainText(data.items[data.items.length - 1].type);
  await page.waitForLoadState('networkidle');
  await noErrorBox(page, '관측 Events 직접 진입');
  expect([...missing], '이벤트 조회가 생성된 스냅샷 파일을 요청해야 한다').toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 데모: 관측 Traces 직접 진입은 300건 조회 JSON 스냅샷과 표를 읽는다', async ({ page }) => {
  const { missing, errors } = watch(page);
  const snapshot = await page.request.get('/api-snapshot/integrations_otel_spans_limit_300.json');
  expect(snapshot.status()).toBe(200);
  expect(snapshot.headers()['content-type']).toContain('json');
  const data = await snapshot.json();
  expect(Array.isArray(data.items)).toBe(true);
  expect(data.items.length).toBeGreaterThan(0);
  expect(data.items[0].traceId).toEqual(expect.any(String));
  await page.goto('/ops/telemetry?tab=observability&observe=traces');
  await expect(page.getByRole('tab', { name: '지표·추적·이벤트', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Traces', exact: true })).toHaveAttribute('aria-selected', 'true');
  const table = page.getByRole('table', { name: '평가 요청 추적', exact: true });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toContainText(data.items[0].traceId);
  await page.waitForLoadState('networkidle');
  await noErrorBox(page, '관측 Traces 직접 진입');
  expect([...missing], '추적 조회가 생성된 300건 스냅샷 파일을 요청해야 한다').toEqual([]);
  expect(errors).toEqual([]);
});

// 변경 요청 상세는 시드에 고정 번호가 없다 — 정적 데모용 예시 요청(snapshot-api.ts)을 목록에서 연다
test('정적 데모: Feature DB 변경 요청 상세 (목록에서 열기)', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/master/feature-db/changes');
  await openAllTabs(page);
  // 탭을 모두 돈 뒤에는 마지막 탭(반려)에 있다 — '전체'로 돌아가 예시 요청을 연다
  await page.getByRole('tab').first().click();
  const link = page.locator('#main a[href^="/master/feature-db/changes/CR-"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/master\/feature-db\/changes\/CR-\d{4}-\d+$/);
  await expect(page.locator('#cr-diff-h')).toBeVisible();
  await openAllTabs(page);
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// Feature DB 목록 → 다른 쪽·상태·도메인 → 기준 행 상세, 등록 1단계 도메인·컴포넌트 패싯도 스냅샷만으로
test('정적 데모: Feature DB 쪽·필터·상세와 등록 1단계 패싯', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/master/feature-db?page=1');
  await openAllTabs(page);
  await page.goto('/master/feature-db?status=REVIEW');
  await openAllTabs(page);
  await page.goto('/master/feature-db?domain=Chassis%20%26%20Vehicle%20Dynamics');
  await openAllTabs(page);
  // 탭을 모두 돈 뒤에는 마지막 탭(출처)에 있다 — '기준 행'으로 돌아가 행을 연다
  await page.getByRole('tab').first().click();
  await page.locator('#main a[href^="/master/feature-db/CH-"]').first().click();
  // 상세로 옮겨 간 뒤에 탭을 센다 — 목록의 탭(기준 행·출처)을 세면 사라진 탭을 누른다
  await expect(page).toHaveURL(/\/master\/feature-db\/CH-/);
  await expect(page.locator('#ref-identity-h')).toBeVisible();
  await openAllTabs(page);
  await page.goto('/feature/propose');
  await openRefPicker(page);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.locator('select[name="refDomain"]').selectOption('Chassis & Vehicle Dynamics');
  await page.locator('select[name="refComponent"]').selectOption('Brake control (ESC/ABS)');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main [data-state="error"]')).toHaveCount(0);
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 기준 행이 연결된 Feature(FEAT-00145 스마트 크루즈 컨트롤) — '기준 행' 탭의 상태·'바뀐 버전'이 스냅샷으로 채워진다.
// 연결은 Version 상세에만 있다 — 목록에서 모으면 '바뀐 버전' 칸이 늘 '—'였다(하네스 리뷰 F4)
test('정적 데모: 기준 행이 연결된 Feature의 기준 행 탭', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/features/FEAT-00145/5.5.0?tab=refs');
  const table = page.getByRole('table', { name: '연결된 기준 행' });
  await expect(table).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(table.locator('[data-ref-status]').first()).toBeVisible();
  // '바뀐 버전' 칸 — 읽지 못하면 '—'(로딩)로 남는다
  await expect(table.getByText(/변경 없음|에서 바뀜/).first()).toBeVisible();
  await noErrorBox(page, 'FEAT-00145 기준 행 탭');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 검색 — 정적 데모에는 검색어 스냅샷이 없다. 받아 둔 전체 목록에서 화면이 찾는다(오류 상자 없음, 하네스 리뷰 F5)
test('정적 데모: Feature DB 목록·등록 1단계 검색 AVH', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/master/feature-db');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: '검색' }).fill('AVH');
  await expect(page.locator('#main a[href="/master/feature-db/CH-BRK-009"]').first()).toBeVisible();
  await noErrorBox(page, 'Feature DB 검색');
  await page.goto('/feature/propose');
  await openRefPicker(page);
  await page.locator('input[name="refSearch"]').fill('AVH');
  await expect(page.getByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' })).toBeVisible();
  await noErrorBox(page, '등록 1단계 검색');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 부서 작업공간 홈 14개 — 부서를 고르면 홈('/')이 그 부서의 작업공간으로 바뀐다(부서의 기본 계정)
const DEPTS = (JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'src', 'generated', 'departments.ts'), 'utf8').replace(/^[\s\S]*?=\s*/, '').replace(/;\s*$/, '')) as { departments: { id: string; name: string; workspace: string; personas: string[] }[] }).departments;
test('정적 데모: 부서 목록을 생성 파일에서 읽었다', () => expect(DEPTS.length).toBe(14));
for (const d of DEPTS) {
  test(`정적 데모: 부서 작업공간 홈 — ${d.name}`, async ({ page }) => {
    const { missing, errors } = watch(page);
    await page.addInitScript((s) => localStorage.setItem('fp.state.v2', JSON.stringify(s)), { role: d.personas[0], department: d.id, theme: 'light' });
    await page.goto('/');
    await expect(page.locator(`#main [data-workspace-home="${d.workspace}"]`)).toBeVisible();
    await openAllTabs(page);
    expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// 알림 종 팝오버 — 머리줄(본문 밖)이라 메뉴 시험이 보지 않는다
test('정적 데모: 알림 종 팝오버', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.locator('.sh-ntf > button').click();
  const pop = page.locator('.sh-ntf__pop');
  await expect(pop).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(pop.locator('[data-state="error"]'), '알림 팝오버에 오류 상자').toHaveCount(0);
  const empties: string[] = [];
  await collectEmpty(page, '.sh-ntf__pop', '알림 팝오버', empties);
  expect.soft(empties, '알림 팝오버에 빈 상태가 보인다').toEqual([]);
  await expect(pop.locator('li').first(), '알림 팝오버에 알림이 한 건 이상').toBeVisible();
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// ── 알림·운영 지표·OFREP·상세 서랍(묶음 F1) — 정적에서 조회를 끄고 안내만 그리던 곳을 스냅샷으로 채운다(2026-11-05) ──

/** 화면 전체(서랍·팝오버 포함)의 오류 상자 0 — '데모에 없는 데이터입니다'(스냅샷 404)가 서랍 안에 뜨던 결함 */
async function noErrorAnywhere(page: Page, where: string) {
  await expect(page.locator('[data-state="error"]'), `${where}: 오류 상자가 보인다`).toHaveCount(0);
}

test('정적 데모: 알림 센터 — 받은 알림·범주·안 읽음/전체 보기', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/notifications');
  const rows = page.getByTestId('notification-row');
  await expect(rows.first()).toBeVisible();
  // 상단 종 배지 — 안 읽은 수. 100건 이상은 '99+'로 줄여 보인다(전시 시드 196건 — Number('99+')가 NaN이라 실패하던 시험 결함, 2026-11-06).
  // 정확한 수는 종 단추의 접근 이름에 있다
  await expect(page.getByTestId('notify-badge')).toHaveText(/^([1-9]\d?|99\+)$/);
  expect(Number((await page.getByRole('button', { name: /^알림 — 안 읽음 \d+건$/ }).getAttribute('aria-label'))!.match(/\d+/)![0])).toBeGreaterThan(0);
  // 범주마다(받은 알림이 있는 범주만 고른다) — 안 읽음 보기와 전체 보기 모두 행이 있다
  const select = page.getByRole('combobox', { name: '범주' });
  const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(values.length, '알림 범주가 여럿').toBeGreaterThan(1);
  for (const v of values) {
    await select.selectOption(v);
    await expect(rows.first(), `안 읽음 · ${v}`).toBeVisible();
  }
  await select.selectOption('');
  await page.getByRole('radio', { name: /^전체/ }).click();
  await expect(rows.first()).toBeVisible();
  for (const v of values) {
    await select.selectOption(v);
    await expect(rows.first(), `전체 · ${v}`).toBeVisible();
  }
  // 읽음 처리는 쓰기 — 정적 공개 사이트도 이 브라우저의 시연 데이터로 처리된다(20-60). 하나 읽으면 안 읽음 수가 준다
  const bell = page.getByRole('button', { name: /^알림 — 안 읽음 \d+건$/ });
  const before = Number((await bell.getAttribute('aria-label'))!.match(/\d+/)![0]);
  await page.getByRole('button', { name: '읽음', exact: true }).first().click();
  await expect.poll(async () => Number((await bell.getAttribute('aria-label'))!.match(/\d+/)![0])).toBe(before - 1);
  await page.waitForLoadState('networkidle');
  await noErrorAnywhere(page, '알림 센터');
  const empties: string[] = [];
  await collectEmpty(page, '#main', '알림 센터', empties);
  expect.soft(empties, '알림 센터에 빈 상태가 보인다').toEqual([]);
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 데모: 운영 지표 탭 — 스냅샷의 처리 지표 표', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/ops/telemetry?tab=observability&observe=metrics');
  await expect(page.getByRole('tab', { name: 'Metrics', exact: true })).toHaveAttribute('aria-selected', 'true');
  const table = page.getByRole('table', { name: '처리 지표', exact: true });
  await expect(table.locator('tbody tr').first()).toBeVisible();
  expect(await table.locator('tbody tr').count()).toBeGreaterThan(0);
  await expect(page.locator('#main')).not.toContainText('수집하지 않습니다');
  await page.waitForLoadState('networkidle');
  await noErrorAnywhere(page, '운영 지표 탭');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 데모: 활성화 판단 — OFREP 응답과 OpenFeature 값(차량·Flag 바꾸기)', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/activation/decide?tab=policy'); // OFREP·OpenFeature는 '정책 평가' 탭(ADS-UI, 통합 12단계)
  const ofrep = page.getByTestId('ofrep-response');
  await expect(ofrep).toContainText('"key"');
  await expect(page.getByTestId('of-value')).toHaveText(/^(ON|OFF)$/);
  await expect(page.locator('#main')).not.toContainText(/OFREP를 호출하지 않습니다|OFREP 서버가 없습니다/);
  // 다른 차량·다른 Flag도 받아 둔 응답으로 그린다
  const [vehicle, flag] = [page.getByRole('combobox', { name: '차량' }), page.getByRole('combobox', { name: 'Flag' })];
  const vins = await vehicle.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const flags = await flag.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  await vehicle.selectOption(vins.at(-1)!);
  await flag.selectOption(flags.at(-1)!);
  await expect(ofrep).toContainText(`"${flags.at(-1)}"`);
  await expect(page.getByTestId('of-value')).toHaveText(/^(ON|OFF)$/);
  await page.waitForLoadState('networkidle');
  await noErrorAnywhere(page, '활성화 판단');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 목록 행을 열면 상세(서랍·패널)를 따로 읽는다 — 목록에 나오는 모든 행의 상세가 스냅샷에 있어야 한다
for (const url of ['/ops/anomalies', '/experiments', '/ops/kill', '/baselines', '/ops/rollback', '/ops/safety-kpi', '/validations/virtual', '/policies', '/policies/POL-00001']) {
  test(`정적 데모: 목록 행 상세 열기 (${url})`, async ({ page }) => {
    test.setTimeout(180_000);
    const { missing, errors } = watch(page);
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const rows = page.locator('#main tbody tr[data-clickable="true"]');
    if (url === '/ops/rollback') {
      const response = await page.request.get('/' + snapshotFile(routeUrl('rollbacks')));
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('json');
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
      if (data.items.length === 0) {
        await capturedZero('rollbacks')(page);
        const history = page.getByRole('region', { name: '롤백 이력', exact: true });
        await expect(history.locator('[data-state="empty"]')).toBeVisible();
        await expect(history.locator('tbody tr[data-clickable="true"]')).toHaveCount(0);
        await noErrorAnywhere(page, '롤백 미실행 원천 0건');
        expect([...missing]).toEqual([]);
        expect(errors).toEqual([]);
        test.info().annotations.push({ type: 'normal-zero', description: '원천 rollback 실행 이력 0건과 일치 — 생성·독립 승인·실행은 policy-ops-flow에서 검증' });
        return;
      }
    }
    await expect(rows.first(), '열 수 있는 행이 한 줄 이상').toBeVisible();
    const empties: string[] = [];
    const n = Math.min(await rows.count(), 30);
    for (let i = 0; i < n; i++) {
      const before = page.url();
      await rows.nth(i).click();
      // 서랍은 주소(?request= 등)가 바뀐 뒤 늦게 열린다 — 바로 보면 '서랍 없음'으로 지나가고, 뒤늦게 열린 서랍의 가림막이 다음 행 클릭을 막아
      // 시간 초과였다(전시 시드 /baselines 25행, 2026-11-06). 서랍이 열리거나 다른 화면으로 옮겨 갈 때까지 잠깐 기다린다
      await expect
        .poll(async () => (await page.locator('.ds-drawer').isVisible()) || new URL(page.url()).pathname !== new URL(before).pathname, { timeout: 3_000 })
        .toBe(true)
        .catch(() => undefined);
      await page.waitForLoadState('networkidle');
      await noErrorAnywhere(page, `${url} 행 ${i + 1}`);
      if (await page.locator('.ds-drawer').isVisible()) {
        await collectEmpty(page, '.ds-drawer', `${url} 행 ${i + 1} 서랍`, empties);
        await page.keyboard.press('Escape');
        await expect(page.locator('.ds-drawer')).toHaveCount(0);
      } else if (new URL(page.url()).pathname !== new URL(before).pathname) {
        // 행이 상세 화면으로 옮겨 간다(정책 목록 → 정책 상세) — 그 화면을 본 뒤 목록으로 돌아온다
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.goto(before);
        await expect(rows.first()).toBeVisible();
        await page.waitForLoadState('networkidle');
      }
    }
    expect.soft(empties, '상세 서랍에 빈 상태가 보인다').toEqual([]);
    expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('정적 데모: 정책 상세 Unleash 차량별 대조', async ({ page }) => {
  const { missing, errors } = watch(page);
  // 지금 배포된 care_00022_signal 정책 — 데모 시드가 같은 값의 새 판을 배포해 POL-00001은 복구 후보(앞 판)다(2026-11-06)
  const deployed = (await (await page.request.get('/api-snapshot/policies_status_DEPLOYED.json')).json()).items.find((p: { flagKey: string }) => p.flagKey === 'care_00022_signal');
  await page.goto(`/policies/${deployed.policyId}`);
  await page.getByRole('button', { name: '차량별 대조' }).click();
  await expect(page.getByRole('table', { name: '차량별 대조' }).locator('tbody tr').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await noErrorAnywhere(page, 'Unleash 차량별 대조');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 데모: 가상검증 — 실행 기록·Evidence 보고서 링크', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/validations/virtual');
  const report = page.getByTestId('sim-report');
  await expect(report).toHaveAttribute('href', /api-snapshot\/files\/virtual\/.+\/report\.html$/);
  const res = await page.request.get((await report.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('html');
  await page.locator('#main tbody tr[data-clickable="true"]').first().click();
  await expect(page.locator('.ds-drawer a[href*="api-snapshot/files/virtual/"]').first()).toBeVisible();
  await noErrorAnywhere(page, '가상검증');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 회귀(2026-11-06 로컬 의존 점검): 검증 서버 패널에 빌드 PC의 127.0.0.1:2100·실행기·Python 경로가, 재현 정보에 사용자 임시 폴더가 보였다
test('정적 데모: 가상검증 — 검증 서버 패널·재현 정보에 빌드 PC 흔적이 없다', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/validations/virtual');
  const panel = page.locator('[data-tour="sim-status"]');
  await expect(panel).toContainText(/CARLA \d+\.\d+/);
  await expect(panel).toContainText('마지막 실행');
  await expect(panel).not.toContainText(/127\.0\.0\.1|localhost|:2100|ffcarla_cli|python|[A-Z]:[\\/]/);
  await page.locator('#main tbody tr[data-clickable="true"]').first().click();
  const drawer = page.locator('.ds-drawer');
  await expect(drawer).toContainText('--replay "evidence/');
  await expect(drawer).not.toContainText(/AppData|[A-Z]:[\\/]|\/tmp\/|\/home\//);
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 외부 시연 창 GitLab 보기 — Feature 상세 연계 탭의 MR 링크가 여는 창(예전에는 gitlab.ff.example로 깨졌다)
test('정적 데모: 외부 시연 창 GitLab — MR 상세·변경 파일·연결된 Feature', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/external.html?system=gitlab');
  await expect(page.getByTestId('gl-detail')).toBeVisible();
  await expect(page.getByTestId('gl-changes')).toBeVisible();
  await expect(page.getByTestId('gl-linked')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// Variant 지원 조건 — 차량별 지원 표의 Feature 링크·입력은 키트 밖 Feature도 연다(FEAT-00022만 받아 둔 결함)
test('정적 데모: Variant 지원 조건 — 키트 밖 Feature Version', async ({ page }) => {
  const { missing, errors } = watch(page);
  const list = await (await page.request.get('/api-snapshot/features_latestOnly_false.json')).json();
  const other = (list.items as { featureId: string; version: string }[]).filter((f) => f.featureId !== 'FEAT-00022').slice(0, 3);
  expect(other.length).toBeGreaterThan(0);
  for (const f of other) {
    await page.goto(`/variant-conditions?featureId=${f.featureId}&version=${f.version}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await noErrorAnywhere(page, `Variant ${f.featureId} ${f.version}`);
  }
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});
