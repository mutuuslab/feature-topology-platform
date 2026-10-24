// 홈 대시보드(/) 3초 테스트(UX3-13, 2026-10-24) — 역할을 바꾸면 셸이 역할별 홈(store roleHome)으로 옮기므로 홈은 캡처에서 빠졌다.
// 저장된 역할로 /에 바로 들어가면 옮기지 않는다 → 9역할 × 1366·1920에서 three-second.spec과 같은 규칙을 본다.
// 홈은 역할마다 핵심 메시지(긴급 차단·내 검토·내 업무 절차)와 업무 절차 지도가 달라진다.
//   ① 핵심 메시지 정확히 1개, 첫 화면 위쪽(320px 안)  ② 화면에서 가장 큰 글자(H1보다 크다)
//   ③ 핵심 메시지 문장·행동 링크를 본문에서 글자 그대로 되풀이하지 않는다  ④ 헤드라인 한 패턴(숫자 값·톤·본문색 문장)
//   ⑤ 본문(#main)의 보이는 글자에 규칙·컴포넌트 코드 없음  ⑥ 머리표·KPI 타일 줄 없음, 머리 설명 한 줄
//   ⑦ 요약 줄 '내 차례 0'이 핵심 메시지와 같은 말 · 어두운 히어로가 가장 진한 요소(UX3-15) — key-message-rules.ts ⑪⑫
import { expect, test, type Page } from '@playwright/test';
import { summaryAndZone } from './key-message-rules';

const ROLES = ['author', 'approver', 'quality', 'operator', 'steward', 'commerce', 'integrator', 'coordinator', 'viewer'];
const CODE = /FFG-[A-Z]+-\d|\bIF-\d|\bD0\d-\d|보고서 \d|§\d/;
const BODY_CODE = new RegExp(String.raw`${CODE.source}|\bCS-\d|\bCLASSIFY-GATE\b|\bKILL-DC\d`);
const KEY_VALUE = /^(?:[—…]|[+−-]?\d[\d,.]*\s*(?:%|s|ms|분|건|개|대|일)?(?:\s*\/\s*\d[\d,.]*)?)$/;
const ZERO = /^0+(?:\.0+)?\s*(?:%|건|개|대)?(?:\s*\/\s*\d+)?$/;

async function home(page: Page, role: string, width: number) {
  await page.addInitScript((r) => localStorage.setItem('fp.state.v2', JSON.stringify({ role: r })), role);
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
  await page.goto('/');
  await expect(page.locator('#main h1').first()).toBeVisible();
  // 역할별 홈으로 옮겨 가지 않는다 — 이 시험이 홈을 보는 유일한 경로
  expect(new URL(page.url()).pathname).toBe('/');
  // 핵심 메시지는 데이터가 오기 전에 '—'(판정 보류) — 판정이 난 뒤를 본다
  await page.waitForFunction(() => document.querySelector('#main [data-key-message] .ds-key__value')?.textContent?.trim() !== '—', null, { timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);

  const key = page.locator('#main [data-key-message]');
  await expect(key, '핵심 메시지는 화면마다 정확히 1개').toHaveCount(1);
  expect((await key.boundingBox())!.y, '핵심 메시지는 첫 화면 위쪽(320px 안)').toBeLessThan(320);

  const sizes = await page.evaluate(() => {
    const px = (e: Element) => parseFloat(getComputedStyle(e).fontSize);
    const k = document.querySelector('#main [data-key-message]')!;
    const keyMax = Math.max(...[k, ...k.querySelectorAll('*')].map(px));
    let other = 0;
    let who = '';
    for (const e of document.querySelectorAll('#main *')) {
      if (k.contains(e) || e.closest('svg, canvas, [aria-hidden="true"]')) continue;
      if (![...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
      const r = (e as HTMLElement).getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') continue;
      if (px(e) > other) (other = px(e)), (who = `${e.tagName}.${(e as HTMLElement).className} "${e.textContent!.trim().slice(0, 30)}"`);
    }
    return { keyMax, h1: px(document.querySelector('#main h1')!), other, who };
  });
  expect(sizes.keyMax, '핵심 메시지 글자가 H1보다 크다').toBeGreaterThan(sizes.h1);
  expect(sizes.keyMax, `핵심 메시지가 화면에서 가장 큰 글자 — 더 큰 것: ${sizes.who}`).toBeGreaterThanOrEqual(sizes.other);

  await expect(page.locator('#main .ds-page .ds-eyebrow'), '머리에 추적 코드 머리표 없음').toHaveCount(0);
  await expect(page.locator('#main .ds-kpis'), 'KPI 타일 줄 없음').toHaveCount(0);
  for (const lead of await page.locator('#main .ds-page__lead').allTextContents()) {
    expect(lead.length, `머리 설명은 한 줄(70자 이하): ${lead}`).toBeLessThanOrEqual(70);
    expect(lead).not.toMatch(CODE);
  }

  const repeated = await page.evaluate(() => {
    const k = document.querySelector('#main [data-key-message]')!;
    const said = [...k.querySelectorAll('.ds-key__text, a, button')].map((e) => e.textContent!.trim()).filter((t) => t.length >= 6);
    const dup: string[] = [];
    for (const e of document.querySelectorAll('#main *')) {
      if (k.contains(e) || e.closest('[aria-hidden="true"], .ds-explain, .ds-page__codes')) continue;
      const r = (e as HTMLElement).getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const t = e.textContent!.trim();
      if (said.includes(t) && ![...e.children].some((c) => c.textContent!.trim() === t)) dup.push(`${e.tagName}.${(e as HTMLElement).className} "${t}"`);
    }
    return dup;
  });
  expect(repeated, '핵심 메시지를 본문에서 되풀이하지 않는다').toEqual([]);

  const head = await page.evaluate(() => {
    const k = document.querySelector('#main [data-key-message]')!;
    const text = k.querySelector('.ds-key__text');
    return {
      tone: k.getAttribute('data-tone') ?? '',
      value: k.querySelector('.ds-key__value')?.textContent?.trim() ?? null,
      textColor: text ? getComputedStyle(text).color : '',
      ink: getComputedStyle(document.querySelector('#main')!).color,
    };
  });
  expect(['ok', 'warn', 'danger', 'neutral']).toContain(head.tone);
  if (head.value != null) {
    expect(head.value, `헤드라인 큰 값은 숫자: "${head.value}"`).toMatch(KEY_VALUE);
    if (ZERO.test(head.value)) expect(head.tone).toBe('neutral');
  }
  expect(head.textColor, '헤드라인 문장 글자는 본문색').toBe(head.ink);

  const codes = await page.evaluate((src) => {
    const re = new RegExp(src);
    const out: string[] = [];
    const walk = document.createTreeWalker(document.querySelector('#main')!, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent!.trim();
      const el = n.parentElement;
      if (!t || !el || !re.test(t) || el.closest('.ds-explain, .ds-explain-block, .ds-page__codes, [aria-hidden="true"], svg, canvas, script, style, option, pre, details:not([open]) > :not(summary)')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      if (![...range.getClientRects()].some((r) => r.width && r.height) || getComputedStyle(el).visibility === 'hidden') continue;
      out.push(`${el.tagName}.${el.className} "${t.slice(0, 50)}"`);
    }
    return out;
  }, BODY_CODE.source);
  expect(codes, '본문에 규칙·컴포넌트 코드 없음 — 설명 모드나 title 툴팁으로').toEqual([]);
  await summaryAndZone(page);
  // UX3-15 시각 검토: 히어로가 210px·제목 16px 두 줄로 핵심 메시지와 같은 무게였다 — 낮고 작은 보조 요소로
  const hero = await page.evaluate(() => {
    const px = (e: Element | null) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0);
    const h = document.querySelector('#main .dh');
    return { height: h?.getBoundingClientRect().height ?? 0, title: px(h?.querySelector('h2') ?? null), key: px(document.querySelector('#main [data-key-message] .ds-key__text')) };
  });
  expect(hero.height, '홈 히어로 높이').toBeLessThanOrEqual(160);
  expect(hero.title, '히어로 제목은 핵심 메시지 문장보다 작다').toBeLessThan(hero.key);
}

for (const width of [1366, 1920]) for (const role of ROLES) test(`3초(홈): ${role} ${width}`, ({ page }) => home(page, role, width));
