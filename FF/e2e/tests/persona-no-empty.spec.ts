// 데모는 비지 않는다(담당자 웨이브 W6, 2026-11-05 사용자 결정 — "내용이 없음" 금지, 데이터로 채운다).
// 모든 메뉴 화면·하위 화면 표본, 데모 계정 12명의 홈·첫 화면, 14개 부서의 작업공간 홈(부서 안 계정마다)을 열고
// 다 그려진 뒤 빈 상태 표식이 없는지 본다. 데이터는 부팅 데모 활동 시드(DemoActivitySeeder)가 채운다.
//   ① 빈 상태 상자(EmptyState, data-state=empty — 핵심 메시지가 대신 말하는 숨은 빈 목록 data-empty-hidden 포함)
//   ② 빈 문구 '아직 … 없습니다'·'표시할 항목이 없습니다'·'기록이 없습니다'
//   ③ 데이터 행이 0인 표(tbody)
//   ④ 판정이 끝난 뒤에도 값이 '—'인 핵심 메시지
// 허용 목록(ALLOW)은 사람이 입력하기 전의 빈 칸·검색 결과 없음·외부 연결 상태 고지처럼 데이터로 채울 수 없는 것만, 이유와 함께 둔다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';
import { settle } from './settle';

const FF = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(FF, p), 'utf8');

/** 데모 계정 — contracts DEMO_PERSONAS의 키(앱 코드를 import하지 않고 소스를 읽는다) */
const ACCOUNTS = [...(read('contracts/src/rules/duty-separation.ts').match(/DEMO_PERSONAS[^{]*\{([\s\S]*?)\n\};/)?.[1] ?? '').matchAll(/^\s+(\w+): \[/gm)].map((m) => m[1]);
/** 계정별 첫 화면 — store.tsx roleHome */
const ROLE_HOME = Object.fromEntries([...(read('frontend/src/store.tsx').match(/roleHome[^{]*\{([\s\S]*?)\n\};/)?.[1] ?? '').matchAll(/^\s+(\w+): '([^']+)'/gm)].map((m) => [m[1], m[2]]));
/** 부서와 부서 안 계정 — 생성 파일(업무 절차 모델) */
const DEPTS = (JSON.parse(read('contracts/src/generated/departments.ts').replace(/^[\s\S]*?=\s*/, '').replace(/;\s*$/, '')) as { departments: { id: string; name: string; workspace: string; personas: string[] }[] }).departments;

const SCREENS = [...MENU_ENTRIES.map((m) => ({ title: m.title, url: m.menu })), ...DRILLDOWNS.map((d) => ({ title: d.title, url: d.url }))].filter((s) => !s.url.startsWith('/_') && !s.url.startsWith('/twin'));
const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
// 소스 형식이 바뀌어 표본 추출이 비어도 담당자·부서 시험이 조용히 사라지지 않는다.
if (!ACCOUNTS.length || !DEPTS.length || !SCREENS.length) throw new Error('빈 화면 하네스의 계정·부서·화면 표본을 읽지 못했습니다');
for (const account of ACCOUNTS) if (!ROLE_HOME[account]) throw new Error(`데모 계정 ${account}의 첫 화면이 없습니다`);

/**
 * 하위 화면 표본 — menu.ts의 고정 표본은 시드 기준정보(이력 없는 첫 정책·연결 없는 기준 행)라 이력 칸이 빈다.
 * 이 시험은 데모 활동이 채운 대상을 연다: 두 판 배포·되돌리기 요청이 있는 정책, 데모 Feature가 쓰는 기준 행, 첫 협의 요청.
 */
async function sampleOf(path: string, fallback: string): Promise<string> {
  const get = async (u: string) => {
    const r = await fetch(API + u, { headers: { 'X-Actor-Id': 'usr-viewer', 'X-Actor-Role': 'AUDITOR' } });
    expect(r.ok, `${u}: ${r.status}`).toBe(true);
    return (await r.json()) as { items?: any[] };
  };
  if (path === '/policies/:id') {
    const rb = (await get('/api/rollback-requests?status=REQUESTED')).items?.[0];
    return rb?.deployed?.policyId ? `/policies/${rb.deployed.policyId}` : fallback;
  }
  if (path === '/master/feature-db/:refId') {
    const links = JSON.parse(read('data/reference/feature-db/seed-links.json')) as { links: Record<string, { refId: string }[]> };
    const first = Object.values(links.links).flat()[0]?.refId;
    return first ? `/master/feature-db/${first}` : fallback;
  }
  if (path === '/consults/:id') {
    const c = (await get('/api/consultations?status=ANSWERED')).items?.[0];
    expect(c?.consultId, '데모 협의 요청 표본이 있어야 한다').toBeTruthy();
    return `/consults/${c.consultId}`;
  }
  return fallback;
}
const PATH_OF = new Map(DRILLDOWNS.map((d) => [d.url, d.path]));

/** 허용 — [경로 정규식, 표식 정규식, 이유]. 표식은 '[패널 제목] 글자'(빈 상자·문구·표 머리) */
const ALLOW: [RegExp, RegExp, string][] = [
  [/^\/feature\/propose/, /고른 기준 행이 없습니다/, '제안 서랍의 입력 전 빈 칸 — 사람이 기준 행을 고르기 전 상태'],
  [/^\/master\/feature-db\/[A-Z]/, /진행 중이거나 지난 변경 요청이 없습니다/, '변경 요청이 한 번도 없었던 기준 행 표본(CH-BRK-009) — 기준 행 1,054개 중 요청이 있는 행은 일부다'],
  [/.*/, /검색 결과가 없습니다|조건에 맞는 항목이 없습니다/, '검색·필터 결과 없음 — 사람이 고른 조건의 결과'],
  [/^\/validations\/virtual|^\/policies\//, /검증 서버 미연결/, '외부 가상검증 서버(CARLA) 연결 상태 고지 — 시험 대역은 실행 기록을 만들지 않는다'],
  [/^\/learn\//, /아직 연결 전/, '따라하기 모드 안내(연결 상태 고지)'],
  [/^\/entitlements/, /과금 시스템에 아직 연결되지 않았습니다/, '외부 과금 시스템 미연결 고지 — 모의 응답임을 알린다'],
  [/^\/validations\/virtual|^\/policies\//, /^\[(CARLA 가상검증|실행 이력|)\] (차량 내 감지 실행 기록이 아직 없습니다|표시할 항목이 없습니다)/, '가상검증 실행 기록은 검증 서버(CARLA)가 만든다 — 데모 시드는 외부 실행 결과를 지어내지 않는다(검증 서버를 붙이면 채워진다)'],
];

const allowed = (url: string, m: { where: string; text: string }) => ALLOW.some(([u, t]) => u.test(url) && t.test(`[${m.where}] ${m.text}`));

interface Mark {
  kind: 'empty' | 'phrase' | 'table' | 'key';
  text: string;
  where: string;
}

/** 다 그려진 화면의 빈 상태 표식 */
async function emptyMarks(page: Page): Promise<Mark[]> {
  return page.evaluate(() => {
    const main = document.querySelector('#main');
    if (!main) return [];
    const vis = (e: Element) => (e as HTMLElement).checkVisibility?.() ?? !!(e as HTMLElement).offsetParent;
    const where = (e: Element) => {
      const p = e.closest('section, article, .ds-panel, aside, [data-key-message], main');
      const h = p?.querySelector('h1, h2, h3, h4');
      return (h?.textContent ?? '').trim().slice(0, 40);
    };
    const txt = (e: Element) => (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90);
    const out: { kind: 'empty' | 'phrase' | 'table' | 'key'; text: string; where: string }[] = [];
    for (const e of main.querySelectorAll('[data-state="empty"]')) {
      if (!e.hasAttribute('data-empty-hidden') && !vis(e)) continue;
      // 숨은 빈 목록은 핵심 메시지가 대신 말한다 — 그 문장을 표식 글자로
      const key = e.hasAttribute('data-empty-hidden') ? main.querySelector('[data-key-message] .ds-key__text') : null;
      out.push({ kind: 'empty', text: key ? txt(key) : txt(e) || '(빈 상자)', where: where(e.parentElement ?? e) });
    }
    const PHR = /아직 [^.。]*없습니다|표시할 항목이 없습니다|기록이 없습니다/;
    const tw = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const s = (n.nodeValue ?? '').trim();
      const el = n.parentElement;
      if (!s || !el || !PHR.test(s) || !vis(el) || el.closest('[data-state="empty"], nav, script, style, [role="dialog"]')) continue;
      out.push({ kind: 'phrase', text: s.slice(0, 90), where: where(el) });
    }
    for (const tb of main.querySelectorAll('table')) {
      if (!vis(tb)) continue;
      const rows = [...tb.querySelectorAll('tbody tr')].filter((r) => vis(r) && r.children.length > 1);
      if (!rows.length) out.push({ kind: 'table', text: txt(tb.querySelector('caption, thead') ?? tb), where: where(tb) });
    }
    for (const v of main.querySelectorAll('[data-key-message] .ds-key__value')) if (vis(v) && /^[—–-]$/.test(txt(v))) out.push({ kind: 'key', text: txt(v.closest('[data-key-message]')!), where: '핵심 메시지' });
    return out;
  });
}

async function open(page: Page, url: string, state: { role: string; department?: string }) {
  await page.addInitScript((s) => localStorage.setItem('fp.state.v2', JSON.stringify(s)), { theme: 'light', department: 'ALL', ...state });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(url);
  await expect(page.locator('#main')).toBeVisible();
  await settle(page, { timeout: 20_000 });
  // 데이터가 온 뒤에도 값이 비어 있으면 실패한다 — 시간 초과를 삼키지 않는다.
  await expect(page.locator('#main [data-key-message] .ds-key__value').filter({ hasText: /^—$/ })).toHaveCount(0, { timeout: 15_000 });
}

async function expectFilled(page: Page, label: string) {
  const url = new URL(page.url()).pathname;
  const marks = (await emptyMarks(page)).filter((m) => !allowed(url, m));
  expect(marks.map((m) => `${m.kind} [${m.where}] ${m.text}`), `${label} — 빈 상태가 보인다(데이터로 채우거나, 채울 수 없는 것이면 이유와 함께 ALLOW에)`).toEqual([]);
}

test.describe('메뉴·하위 화면 — 빈 상태 없음', () => {
  for (const s of SCREENS) {
    test(`${s.title} ${s.url}`, async ({ page }) => {
      const url = await sampleOf(PATH_OF.get(s.url) ?? s.url, s.url);
      await open(page, url, { role: 'author' });
      await expectFilled(page, `${s.url} (Feature 설계)`);
    });
  }
});

test.describe('데모 계정 12명 — 홈·첫 화면에 빈 상태 없음', () => {
  test('계정 목록을 소스에서 읽었다', () => {
    expect(ACCOUNTS).toEqual(expect.arrayContaining(['opslead', 'safety2', 'productowner']));
    for (const a of ACCOUNTS) expect(ROLE_HOME[a], `${a} 첫 화면`).toBeTruthy();
  });
  for (const role of ACCOUNTS) {
    test(`${role} 홈·첫 화면`, async ({ page }) => {
      for (const url of [...new Set(['/', ROLE_HOME[role] ?? '/'])]) {
        await open(page, url, { role });
        await expectFilled(page, `${url} (${role})`);
      }
    });
  }
});

test.describe('부서 작업공간 홈 — 부서 안 계정마다 빈 상태 없음', () => {
  for (const d of DEPTS) {
    for (const role of d.personas) {
      test(`${d.name} · ${role}`, async ({ page }) => {
        await open(page, '/', { role, department: d.id });
        await expect(page.locator(`#main [data-workspace-home="${d.workspace}"]`)).toBeVisible();
        await expectFilled(page, `${d.id} 홈 (${role})`);
      });
    }
  }
});
