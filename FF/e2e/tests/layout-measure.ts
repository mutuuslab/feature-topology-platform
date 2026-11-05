// 실제 DOM 배치 측정 — 전체 화면 순회와 Flag 상세·가져오기가 같은 기준을 쓴다.
import type { Page } from '@playwright/test';

export async function sweepChecks(page: Page, scope = 'body') {
  return page.evaluate((scope) => {
    // 서랍은 앞면만 측정한다. 뒤에서 가려진 본문 글자를 서랍 글자와 겹침으로 오인하지 않는다.
    const root = document.querySelector(scope);
    if (!root) throw new Error(`배치 측정 범위가 없습니다: ${scope}`);
    const W = document.documentElement.clientWidth;
    const sig = (e: Element) => `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
    const shown = (e: Element) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const main = document.querySelector('#main');
    // 스크롤 상자로 잘린 글자는 보이지 않는다. #main은 가로 결함을 별도로 잡으므로 세로만 자른다.
    const clipOf = (el: Element) => {
      let c = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (p === main) {
          if (cs.overflowY !== 'visible') {
            const r = p.getBoundingClientRect();
            c.t = Math.max(c.t, r.top);
            c.b = Math.min(c.b, r.bottom);
          }
          continue;
        }
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && cs.clip === 'auto') continue;
        const r = p.getBoundingClientRect();
        c = { l: Math.max(c.l, r.left), t: Math.max(c.t, r.top), r: Math.min(c.r, r.right), b: Math.min(c.b, r.bottom) };
      }
      return c;
    };
    const blockOf = (el: Element) => {
      if (el instanceof SVGElement) return el;
      for (let p: Element | null = el; p; p = p.parentElement) if (!/^(inline|contents)/.test(getComputedStyle(p).display)) return p;
      return el;
    };
    // ① 문서 가로 넘침
    const overflow = document.documentElement.scrollWidth - W;
    const wide = overflow > 0
      ? [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > W + 1 && shown(e); }).slice(0, 3).map((e) => `${sig(e)} right=${Math.round(e.getBoundingClientRect().right)}`)
      : [];
    // ② 글자 상자 겹침
    type Box = { el: Element; blk: Element; l: number; t: number; r: number; b: number; s: string };
    const boxes: Box[] = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const s = (n.nodeValue ?? '').trim();
      const el = n.parentElement;
      if (!s || !el || el.closest('script, style, select, option, textarea, noscript, title') || !shown(el)) continue;
      const clip = clipOf(el);
      const rects = el instanceof SVGTextContentElement ? [el.getBoundingClientRect()] : (() => { const rg = document.createRange(); rg.selectNodeContents(n); return [...rg.getClientRects()]; })();
      for (const x of rects) {
        const b = { l: Math.max(x.left, clip.l), t: Math.max(x.top, clip.t), r: Math.min(x.right, clip.r), b: Math.min(x.bottom, clip.b) };
        if (b.r - b.l > 1 && b.b - b.t > 4) boxes.push({ el, blk: blockOf(el), ...b, s: s.slice(0, 24) });
      }
    }
    boxes.sort((a, b) => a.t - b.t);
    const TOL = 2;
    const overlaps: string[] = [];
    // 겹친 곳 맨 위가 두 글자와 상관없는 고정·떠 있는 층(서랍·안내 창)이면 아래 글자는 가려진 것
    const layerOf = (e: Element | null) => { for (let p = e; p; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return p; } return null; };
    for (let i = 0; i < boxes.length && overlaps.length < 8; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length && boxes[j].t < a.b - TOL; j++) {
        const b = boxes[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox <= TOL || oy <= TOL) continue;
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || a.blk === b.blk) continue;
        const x = (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2;
        const y = (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2;
        const top = document.elementFromPoint(x, y);
        const lay = layerOf(top);
        if (lay && !lay.contains(a.el) && !lay.contains(b.el)) continue;
        overlaps.push(`"${a.s}"(${sig(a.el)}) ⨯ "${b.s}"(${sig(b.el)}) ${Math.round(ox)}x${Math.round(oy)} @${Math.round(x)},${Math.round(y)}`);
      }
    }
    // 첫 글줄 상자 — 숨은 글자·select 안 글자는 뺀다
    const firstLine = (el: Element) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!(n.nodeValue ?? '').trim() || !n.parentElement || n.parentElement.closest('select') || !shown(n.parentElement)) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const r = [...rg.getClientRects()].find((x) => x.width > 1 && x.height > 4);
        if (r) return r;
      }
      return null;
    };
    const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
    // ③ .ds-kv 이름(dt)·값(dd) 첫 줄 기준선(글자 상자 아래 끝)
    const kv: string[] = [];
    for (const row of root.querySelectorAll('.ds-kv__row')) {
      const dt = row.querySelector(':scope > dt');
      const dd = row.querySelector(':scope > dd');
      if (!dt || !dd || !shown(row)) continue;
      const a = firstLine(dt);
      const b = firstLine(dd);
      if (a && b && Math.abs(a.bottom - b.bottom) > 3) kv.push(`"${(dt.textContent ?? '').trim().slice(0, 16)}" ↔ "${(dd.textContent ?? '').trim().slice(0, 20)}" ${Math.round(b.bottom - a.bottom)}px`);
    }
    // ④ 고친 한 줄 행 — 내 업무 배지↔제목, 시뮬레이션 체크 상자↔같은 줄 입력 칸, 상단바 도구 가운데
    const rows: string[] = [];
    for (const li of root.querySelectorAll('.ws-work li')) {
      const part = li.querySelector('.ws-part');
      const name = li.querySelector('.ws-work__name');
      if (!part || !name || !shown(li)) continue;
      const a = firstLine(part);
      const b = firstLine(name);
      if (a && b && Math.abs(mid(a) - mid(b)) > 3) rows.push(`ws-part "${(part.textContent ?? '').trim()}" ↔ "${(name.textContent ?? '').trim().slice(0, 16)}" ${Math.round(mid(a) - mid(b))}px`);
    }
    const ctlMid = (e: Element) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    for (const chk of root.querySelectorAll('.twin-filters .twin-check input[type=checkbox]')) {
      if (!shown(chk)) continue;
      const cell = chk.closest('.twin-filter')!.getBoundingClientRect();
      const peers = [...chk.closest('.twin-filters')!.querySelectorAll('.twin-filter:not(.twin-check) :is(input, select)')].filter((p) => { const r = p.closest('.twin-filter')!.getBoundingClientRect(); return Math.abs(r.top - cell.top) < 2; });
      if (peers.length && Math.abs(ctlMid(chk) - ctlMid(peers[0])) > 3) rows.push(`twin-check ${chk.getAttribute('aria-label')} ↔ ${peers[0].getAttribute('aria-label')} ${Math.round(ctlMid(chk) - ctlMid(peers[0]))}px`);
      // 옆 칸처럼 이름·상자가 칸 왼쪽에서 시작한다(가운데로 몰리지 않는다)
      const txt = firstLine(chk.closest('.twin-filter')!);
      const left = Math.max(Math.abs(chk.getBoundingClientRect().left - cell.left), txt ? Math.abs(txt.left - cell.left) : 0);
      if (left > 3) rows.push(`twin-check ${chk.getAttribute('aria-label')} 칸 왼쪽에서 ${Math.round(left)}px`);
    }
    const tools = [...root.querySelectorAll('.sh-tools > *')].filter(shown).map(ctlMid);
    if (tools.length && Math.max(...tools) - Math.min(...tools) > 3) rows.push(`sh-tools 가운데 ${Math.round(Math.max(...tools) - Math.min(...tools))}px`);
    // ⑤ 숫자 열 — 본문 칸이 모두 오른쪽 정렬 숫자인 열은 머리글도 오른쪽
    const side = (a: string) => (a === 'right' || a === 'end' ? 'right' : a === 'center' || a === '-webkit-center' ? 'center' : 'left');
    // 숫자 칸 — 빈 값 표시(—)도 숫자 열에 섞인다. 숫자가 하나는 있어야 한다
    const NUM = /^[\d\s.,%()+\-−~×/:—]+$/;
    const numHead: string[] = [];
    for (const tb of root.querySelectorAll('table')) {
      if (!shown(tb)) continue;
      const head = tb.querySelector(':scope > thead > tr:last-child');
      const body = [...tb.querySelectorAll(':scope > tbody > tr')].slice(0, 12);
      if (!head || !body.length) continue;
      const ths = [...head.children];
      if (ths.some((c) => (c as HTMLTableCellElement).colSpan > 1)) continue;
      ths.forEach((th, i) => {
        if (!(th.textContent ?? '').trim()) return;
        const cells = body.map((tr) => (tr.children.length === ths.length ? tr.children[i] : null)).filter((c): c is Element => !!c && !!(c.textContent ?? '').trim());
        if (!cells.some((c) => /\d/.test(c.textContent ?? '')) || !cells.every((c) => NUM.test((c.textContent ?? '').trim()) && side(getComputedStyle(c).textAlign) === 'right')) return;
        if (side(getComputedStyle(th).textAlign) !== 'right') numHead.push(`${sig(tb)} 열${i + 1} "${(th.textContent ?? '').trim().slice(0, 16)}" 머리글 ${getComputedStyle(th).textAlign} · 칸 오른쪽`);
      });
    }
    return { overflow, wide, overlaps, kv: kv.slice(0, 5), rows: rows.slice(0, 5), numHead: numHead.slice(0, 5) };
  }, scope);
}
