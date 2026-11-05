// 표·패널 배치 회귀 — UI/UX 하네스 2판(2026-10-23)에서 찾은 결함이 다시 생기지 않게 한다.
//  ① 표 칸 글자 중간 줄바꿈: `.sh-main td { overflow-wrap: anywhere }`가 칸 최소 폭을 글자 1개로 줄여
//     'RELEASED'·'SEC-2'·'VIN-DEMO-001'이 글자 단위로 끊겼다(17화면 983칸 @1280).
//  ② 패널 오른쪽 잘림: 좌우 분할(.ds-split) 칸이 긴 코드 줄 때문에 트랙보다 넓어져 /activation/decide 오른쪽 패널이 화면 밖으로 나갔다.
//  ③ 짧은 식별자 칩(.ds-id·.ds-tag·.ds-badge)이 하이픈 뒤에서 두 줄로 갈렸다.
//  ④ 그 수정이 과해 설명이 붙은 Function 태그가 줄을 못 바꿔 카드 밖으로 나갔고, 상품 유효 기간 날짜가 '2027-12-|31'로 갈렸다(시각 회귀에서 발견).
//  ⑤ 하네스 3판(결함 7): 간격 6px가 토큰 없이 5,797회, 4px 격자 밖 간격 2,556회, 반경 13종 — 스케일 밖 계산값 0건.
//  ⑥ 하네스 W6(2026-11-05): 폭 1024~1920·시연 모드 화면 전체 — 문서 가로 넘침·글자 겹침·.ds-kv 기준선·행 정렬·숫자 열 머리글(아래 SWEEP).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';
import { settle } from './settle';
import { sweepChecks } from './layout-measure';
import { apiRefs, REF } from './refdb';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

const SCREENS = [...MENU_ENTRIES.map((m) => ({ title: m.title, url: m.menu })), ...DRILLDOWNS.map((d) => ({ title: d.title, url: d.url }))];

/** 해시(40자 이상) 같은 긴 토큰은 끊길 수 있다 — 대상은 짧은 코드·ID·상태값 */
const MAX_TOKEN = 40;

async function measure(page: Page) {
  return page.evaluate((maxToken) => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const midBreaks: string[] = [];
    const chipBreaks: string[] = [];
    for (const el of document.querySelectorAll('td, td *, th')) {
      const tn = [...el.childNodes].filter((n) => n.nodeType === 3);
      const t = tn.map((n) => n.nodeValue ?? '').join('').trim();
      if (tn.length !== 1 || !t || /\s/.test(t) || t.length < 4 || t.length >= maxToken || !vis(el)) continue;
      const node = tn[0];
      const s = node.nodeValue ?? '';
      let prevTop: number | null = null;
      let mid = false;
      let sep = false;
      for (let i = 0; i < s.length; i++) {
        const rg = document.createRange();
        rg.setStart(node, i);
        rg.setEnd(node, i + 1);
        const rc = rg.getClientRects()[0];
        if (!rc || rc.height < 8) continue;
        if (prevTop !== null && rc.top - prevTop > 8) {
          if (/[-/._:@·]/.test(s[i - 1])) sep = true;
          else mid = true;
        }
        prevTop = rc.top;
      }
      if (mid) midBreaks.push(t);
      if (sep && (el as HTMLElement).closest('.ds-id, .ds-tag, .ds-badge')) chipBreaks.push(t);
    }
    // #main 안의 요소가 가로 스크롤 용기 밖에서 화면 오른쪽을 넘는지
    const W = window.innerWidth;
    const scrolls = (el: Element) => { for (let p = el.parentElement; p && p.id !== 'main'; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; return false; };
    const clipped = [...document.querySelectorAll('#main *')]
      .filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && x.right > W + 1 && getComputedStyle(e).position !== 'fixed' && !scrolls(e); })
      .filter((e) => !e.parentElement || e.parentElement.getBoundingClientRect().right <= W + 1)
      .map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(' ')[0]} right=${Math.round(e.getBoundingClientRect().right)}`);
    // 날짜(YYYY-MM-DD)가 두 줄에 걸치는지 — 공백이 섞인 문장 안의 날짜도 본다
    const dateBreaks: string[] = [];
    const walker = document.createTreeWalker(document.querySelector('#main') ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.nodeValue ?? '';
      if (!n.parentElement || !vis(n.parentElement)) continue;
      for (const m of s.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
        const rg = document.createRange();
        rg.setStart(n, m.index!);
        rg.setEnd(n, m.index! + m[0].length);
        const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size > 1) dateBreaks.push(`${m[0]} (${n.parentElement.tagName.toLowerCase()}.${String(n.parentElement.className).split(' ')[0]} "${s.trim().slice(0, 50)}")`);
      }
    }
    // 칩이 자기 칸(가장 가까운 블록 조상)의 오른쪽 경계를 넘는지 — 스크롤 영역 안은 제외
    const blockOf = (el: Element) => { for (let p = el.parentElement; p; p = p.parentElement) if (!/^(inline|contents)/.test(getComputedStyle(p).display)) return p; return null; };
    const chipOverflow = [...document.querySelectorAll('#main .ds-id, #main .ds-tag, #main .ds-badge')]
      .filter((e) => { if (!vis(e) || scrolls(e)) return false; const b = blockOf(e); return !!b && e.getBoundingClientRect().right > b.getBoundingClientRect().right + 1; })
      .map((e) => (e.textContent ?? '').trim().slice(0, 40));
    // ⑤ 간격·반경 스케일(tools/spacing-scale.ts와 같은 규칙): 계산된 간격은 2px 이하·4px 격자·6px, 40px 초과는 8의 배수,
    //    반경은 3·5·8px·알약·원. 지도 엔진(MapLibre) 컨트롤과 auto 여백(가운데 맞춤)은 제외.
    const onScale = (v: number) => { const a = Math.abs(Math.round(v)); return a <= 2 || a === 6 || (a <= 40 ? a % 4 === 0 && a !== 28 && a !== 36 : a % 8 === 0); };
    const RADII = new Set(['3px', '5px', '8px', '999px', '50%']);
    const sig = (e: Element) => `${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 2).join('.')}`;
    const offScale = new Set<string>();
    for (const e of document.querySelectorAll('#main *')) {
      if (e.closest('[class*="maplibregl"]') || !vis(e)) continue;
      const cs = getComputedStyle(e);
      const spec = (e as HTMLElement).computedStyleMap?.();
      for (const [k, css] of [['paddingTop', 'padding-top'], ['paddingLeft', 'padding-left'], ['marginTop', 'margin-top'], ['marginBottom', 'margin-bottom'], ['rowGap', 'row-gap'], ['columnGap', 'column-gap']] as const) {
        const v = parseFloat(cs[k]);
        if (!v || onScale(v) || String(spec?.get(css)) === 'auto') continue;
        offScale.add(`${css}=${Math.round(v)} ${sig(e)}`);
      }
      const r = cs.borderTopLeftRadius;
      if (r && r !== '0px' && !RADII.has(r)) offScale.add(`radius=${r} ${sig(e)}`);
    }
    return { midBreaks: [...new Set(midBreaks)], chipBreaks: [...new Set(chipBreaks)], clipped, dateBreaks: [...new Set(dateBreaks)], chipOverflow: [...new Set(chipOverflow)], offScale: [...offScale] };
  }, MAX_TOKEN);
}

// ④ 글자 크기 하한: 노트북(1599px 이하) base 13px에서 --fs-xs가 10.2px·--fs-sm이 11.1px로 떨어져 화면 글자의 82%가 10~11px였다.
//    시연 모드는 base만 18px로 키워 표가 15px에 머물렀다.
test('글자 크기 토큰 하한 — 노트북 보조 11px·표 12px, 시연 모드 표 17px 이상', async ({ page }) => {
  const sizes = () =>
    page.evaluate(() => {
      const px = (v: string) => { const i = document.createElement('i'); i.style.fontSize = `var(${v})`; document.body.appendChild(i); const n = parseFloat(getComputedStyle(i).fontSize); i.remove(); return n; };
      const id = document.createElement('span'); id.className = 'ds-id'; const td = document.createElement('table'); td.className = 'ds-table'; td.innerHTML = '<tbody><tr><td></td></tr></tbody>';
      td.querySelector('td')!.appendChild(id); document.body.appendChild(td);
      const idPx = parseFloat(getComputedStyle(id).fontSize); td.remove();
      return { xs: px('--fs-xs'), sm: px('--fs-sm'), idInTable: idPx };
    });
  for (const width of [1366, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/features');
    await expect(page.locator('#main')).toBeVisible();
    const s = await sizes();
    expect(s.xs, `@${width} --fs-xs`).toBeGreaterThanOrEqual(11);
    expect(s.sm, `@${width} --fs-sm`).toBeGreaterThanOrEqual(12);
    expect(s.idInTable, `@${width} 표 안 ID 칩`).toBeGreaterThanOrEqual(11);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => localStorage.setItem('ff.present', '1'));
  await page.goto('/features');
  await expect(page.locator('html')).toHaveAttribute('data-present', 'on');
  const p = await sizes();
  expect(p.sm, '시연 모드 --fs-sm').toBeGreaterThanOrEqual(17);
  expect(p.xs, '시연 모드 --fs-xs').toBeGreaterThanOrEqual(15);
});

for (const s of SCREENS) {
  test(`배치: ${s.title} (${s.url}) — 1366·1280에서 표 글자 끊김·패널 잘림 없음`, async ({ page }) => {
    for (const width of [1366, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(s.url);
      await expect(page.locator('#main')).toBeVisible();
      // 차량 상세처럼 실시간 수신을 계속하는 화면은 networkidle에 닿지 않는다 — 로딩 표식(골격 포함)이 사라질 때까지만, 시간 초과는 실패
      await expect(page.locator('#main .skel, #main .ds-skel'), '골격(로딩)이 끝나지 않았다').toHaveCount(0, { timeout: 15_000 });
      await settle(page);
      const m = await measure(page);
      expect(m.midBreaks, `@${width} 표 칸에서 글자 중간 줄바꿈: ${m.midBreaks.slice(0, 5).join(', ')}`).toEqual([]);
      expect(m.chipBreaks, `@${width} ID·태그·배지 칩이 두 줄로 갈림: ${m.chipBreaks.slice(0, 5).join(', ')}`).toEqual([]);
      expect(m.clipped, `@${width} 화면 오른쪽 밖으로 잘린 요소: ${m.clipped.slice(0, 3).join(', ')}`).toEqual([]);
      expect(m.dateBreaks, `@${width} 날짜가 두 줄로 갈림: ${m.dateBreaks.slice(0, 3).join(', ')}`).toEqual([]);
      expect(m.chipOverflow, `@${width} 칩이 칸 밖으로 넘침: ${m.chipOverflow.slice(0, 3).join(', ')}`).toEqual([]);
      expect(m.offScale, `@${width} 간격·반경 스케일 밖: ${m.offScale.slice(0, 5).join(', ')}`).toEqual([]);
    }
  });
}

// ⑥ 하네스 W6(2026-11-05 화면 측정) — 폭 1024~1920·시연 모드에서 화면 전체를 한 번씩 본다(폭마다 페이지 하나를 다시 쓴다).
//    · 문서 가로 넘침 0: 상단바 도구 줄(.sh-tools)이 1024에서 125px·시연 1366에서 61px 화면 밖으로 나가 로그아웃·알림이 잘렸다(L1)
//    · 글자 겹침 0: 보이는 글자 상자(Range.getClientRects·SVG text 상자)끼리 2px 넘게 겹치지 않는다 — 같은 요소·조상/자손·같은 문단은 뺀다.
//      Topology 노드 라벨(고정 13px 간격, 시연에서 6px 겹침)·/biz/trials 축 눈금(모서리 '0'과 첫 주)이 겹쳤다(L4)
//    · .ds-kv 이름·값 기준선 3px 이내: 이름이 두 줄이면 값이 가운데로 내려가 10~20px 어긋났다(L2)
//    · 한 줄 행 정렬 3px 이내: 부서 홈 내 업무 배지(.ws-part)가 제목보다 9~12px 아래(L3), 시뮬레이션 체크 상자가 입력 칸과 다른 높이(L5)
//    · 숫자 열 머리글: 칸이 오른쪽 정렬 숫자면 머리글도 오른쪽(L6 — 절차 역할 표·대시보드 2차원 통계·범례)
const DEPT_SRC = readFileSync(join(__dirname, '..', '..', 'contracts', 'src', 'generated', 'departments.ts'), 'utf8');
const DEPTS: { id: string; name: string; personas: string[] }[] = JSON.parse(DEPT_SRC.slice(DEPT_SRC.indexOf('= {') + 2, DEPT_SRC.lastIndexOf('}') + 1)).departments;
if (!DEPTS.length || !SCREENS.length) throw new Error('배치 하네스의 부서·화면 표본을 읽지 못했습니다');
const SWEEP = [
  ...[1024, 1280, 1366, 1536, 1920].map((width) => ({ width, present: false })),
  ...[1366, 1920].map((width) => ({ width, present: true })),
];

for (const m of SWEEP) {
  const tag = `${m.width}${m.present ? ' 시연' : ''}`;
  test(`배치 전체 점검 @${tag} — 가로 넘침·글자 겹침·기준선·숫자 머리글 (메뉴 화면 + 14부서 홈)`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await page.setViewportSize({ width: m.width, height: m.width >= 1920 ? 1080 : 800 });
    await page.goto('/');
    await page.evaluate((p) => localStorage.setItem('ff.present', p ? '1' : '0'), m.present);
    const visits = [
      ...SCREENS.map((s) => ({ name: s.url, url: s.url, dept: null as null | { id: string; role: string } })),
      ...DEPTS.map((d) => ({ name: `부서 홈 ${d.name}`, url: '/', dept: { id: d.id, role: d.personas[0] } })),
    ];
    const bad: string[] = [];
    for (const v of visits) {
      await page.evaluate((d) => localStorage.setItem('fp.state.v2', JSON.stringify(d ? { role: d.role, department: d.id } : { role: 'author', department: 'ALL' })), v.dept);
      await page.goto(v.url);
      await expect(page.locator('#main')).toBeVisible();
      if (v.dept) await expect(page.locator('#main [data-workspace-home]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-present', m.present ? 'on' : 'off');
      await expect(page.locator('#main .skel, #main .ds-skel')).toHaveCount(0, { timeout: 15_000 });
      // 오류 상자는 화면별 배치 시험(위)이 본다 — 여기서는 배치만
      await settle(page, { errors: null });
      const r = await sweepChecks(page);
      const key = `${v.name}@${m.width}${m.present ? 'p' : ''}`;
      const report = (check: string, items: string[]) => {
        if (items.length) bad.push(`${key} ${check}: ${items.slice(0, 3).join(' | ')}`);
      };
      if (r.overflow > 0) report('가로 넘침', [`+${r.overflow}px ${r.wide.join(', ')}`]);
      report('글자 겹침', r.overlaps);
      report('이름·값 기준선', r.kv);
      report('행 정렬', r.rows);
      report('숫자 머리글', r.numHead);
    }
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
  });
}

// ⑦ 담당자 시험 P2-10(2026-11-05): 초안 수정 서랍의 좌우 분할(.ds-split)은 오른쪽 칸 최소 320px — 서랍(약 480px)에서 '담당' 입력이
//    26px로 줄어 ASIL 이름과 겹쳤다. 판정 목록(.ds-check) 첫 칸은 아이콘용 22px라 '보완' 같은 판정 낱말이 세로로 갈렸다(변경 요청 검토 의견).
test('초안 수정 서랍 — 담당·ASIL 칸이 제 폭을 갖고 겹치지 않는다 · 판정 낱말은 한 줄', async ({ page, request }) => {
  const r = await request.post(`${API}/api/features`, {
    headers: { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' },
    data: { name: `배치 서랍 ${Math.random().toString(36).slice(2, 7)}`, description: '배치 시험', requirementIds: ['REQ-E2E-LAYOUT'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'], ...apiRefs(REF.trafficLight) },
  });
  expect(r.status(), await r.text()).toBe(201);
  const f = (await r.json()) as { featureId: string };
  for (const m of [{ width: 1366, present: false }, { width: 1920, present: true }]) {
    await page.setViewportSize({ width: m.width, height: m.width >= 1920 ? 1080 : 800 });
    await page.goto('/');
    await page.evaluate((p) => localStorage.setItem('ff.present', p ? '1' : '0'), m.present);
    await page.goto(`/features/${f.featureId}/0.1.0`);
    await page.getByRole('button', { name: '초안 수정' }).click();
    const dlg = page.getByRole('dialog');
    const owner = dlg.getByLabel('담당', { exact: true });
    const asil = dlg.getByLabel('ASIL', { exact: true });
    await expect(owner).toBeVisible();
    await expect.poll(() => dlg.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0);
    const box = await dlg.evaluate((el) => {
      const rect = (e: Element | null) => { const x = e!.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom, w: x.width }; };
      const field = (name: string) => [...el.querySelectorAll('label')].find((l) => (l.textContent ?? '').trim().startsWith(name) && l.querySelector('input, select'))!;
      const o = field('담당');
      const a = field('ASIL');
      return { ownerInput: rect(o.querySelector('input')), asilInput: rect(a.querySelector('select')), asilLabel: rect(a.firstElementChild) };
    });
    const hit = (p: { l: number; r: number; t: number; b: number }, q: { l: number; r: number; t: number; b: number }) => Math.min(p.r, q.r) - Math.max(p.l, q.l) > 1 && Math.min(p.b, q.b) - Math.max(p.t, q.t) > 1;
    expect(box.ownerInput.w, `@${m.width} '담당' 입력 폭`).toBeGreaterThanOrEqual(120);
    expect(box.asilInput.w, `@${m.width} ASIL 선택 폭`).toBeGreaterThanOrEqual(48);
    expect(hit(box.ownerInput, box.asilLabel) || hit(box.ownerInput, box.asilInput), `@${m.width} '담당' 입력이 ASIL 칸과 겹친다`).toBe(false);
    await page.keyboard.press('Escape');
  }
  // 판정 낱말 — 시드에 검토 의견이 있는 변경 요청이 없어 같은 마크업(.ds-check li > 판정 낱말 + 내용)을 본문에 넣어 본다
  const lines = await page.evaluate(() => {
    const ul = document.createElement('ul');
    ul.className = 'ds-check';
    ul.innerHTML = '<li data-state="INFO"><span class="ds-mono">보완</span><span>규모 근거 등급 보완 필요</span></li>';
    document.querySelector('#main')!.prepend(ul);
    const rg = document.createRange();
    rg.selectNodeContents(ul.querySelector('span')!.firstChild!);
    const tops = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
    ul.remove();
    return tops.size;
  });
  expect(lines, "판정 낱말 '보완'이 한 줄").toBe(1);
});
