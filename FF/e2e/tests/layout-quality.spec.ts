// 표·패널 배치 회귀 — UI/UX 하네스 2판(2026-10-23)에서 찾은 결함이 다시 생기지 않게 한다.
//  ① 표 칸 글자 중간 줄바꿈: `.sh-main td { overflow-wrap: anywhere }`가 칸 최소 폭을 글자 1개로 줄여
//     'RELEASED'·'SEC-2'·'VIN-DEMO-001'이 글자 단위로 끊겼다(17화면 983칸 @1280).
//  ② 패널 오른쪽 잘림: 좌우 분할(.ds-split) 칸이 긴 코드 줄 때문에 트랙보다 넓어져 /activation/decide 오른쪽 패널이 화면 밖으로 나갔다.
//  ③ 짧은 식별자 칩(.ds-id·.ds-tag·.ds-badge)이 하이픈 뒤에서 두 줄로 갈렸다.
//  ④ 그 수정이 과해 설명이 붙은 Function 태그가 줄을 못 바꿔 카드 밖으로 나갔고, 상품 유효 기간 날짜가 '2027-12-|31'로 갈렸다(시각 회귀에서 발견).
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

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
    return { midBreaks: [...new Set(midBreaks)], chipBreaks: [...new Set(chipBreaks)], clipped, dateBreaks: [...new Set(dateBreaks)], chipOverflow: [...new Set(chipOverflow)] };
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
      // 차량 상세처럼 실시간 수신을 계속하는 화면은 networkidle에 닿지 않는다 — 첫 데이터까지만 기다린다
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.skel, .ds-skel, [data-state="loading"]'), null, { timeout: 8_000 }).catch(() => {});
      const m = await measure(page);
      expect(m.midBreaks, `@${width} 표 칸에서 글자 중간 줄바꿈: ${m.midBreaks.slice(0, 5).join(', ')}`).toEqual([]);
      expect(m.chipBreaks, `@${width} ID·태그·배지 칩이 두 줄로 갈림: ${m.chipBreaks.slice(0, 5).join(', ')}`).toEqual([]);
      expect(m.clipped, `@${width} 화면 오른쪽 밖으로 잘린 요소: ${m.clipped.slice(0, 3).join(', ')}`).toEqual([]);
      expect(m.dateBreaks, `@${width} 날짜가 두 줄로 갈림: ${m.dateBreaks.slice(0, 3).join(', ')}`).toEqual([]);
      expect(m.chipOverflow, `@${width} 칩이 칸 밖으로 넘침: ${m.chipOverflow.slice(0, 3).join(', ')}`).toEqual([]);
    }
  });
}
