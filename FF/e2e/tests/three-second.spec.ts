// 3초 테스트(2026-10-17 사용자 요청) — 화면을 열면 "지금 알아야 할 한 가지"가 가장 먼저 보이고, 그것을 방해하는 장식·중복은 없다.
// 모든 메뉴 화면과 하위 화면(drill-down)을 1366×768에서 연다. 하드 규칙:
//   ① 핵심 메시지([data-key-message])가 정확히 1개, 첫 화면 위쪽(320px 안)
//   ② 핵심 메시지가 화면에서 가장 큰 글자(H1보다 크다)
//   ③ 머리에 추적 코드 머리표(.ds-eyebrow) 없음 — 코드는 설명 모드(codes)에서만
//   ④ KPI 타일 줄(.ds-kpis) 없음 — 핵심 메시지 하나 + 회색 요약 한 줄
//   ⑤ 머리 설명은 한 줄(70자 이하), FFG·IF·D0x 코드·보고서 절 번호 없음
//   ⑥ 경로 표시는 현재 화면 이름(H1)을 되풀이하지 않는다
//   ⑦ 핵심 메시지 문장·행동 링크를 본문에서 글자 그대로 되풀이하지 않는다
//   ⑧ 헤드라인 한 패턴(하네스 3판, 결함 3): 큰 값은 숫자(건수·비율·분수)만 — 낱말 상태(DEPLOYED·ON)는 상태 pill,
//      톤은 ok·warn·danger·neutral, 문장 글자는 본문색(색은 숫자·pill·표식에만), 값이 0이면 neutral
// BDC 데모(/twin/*)는 별도 레거시 화면 묶음이라, 디자인 갤러리(/_design)는 부품 견본이라 대상에서 뺀다.
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

const SKIP = (u: string) => u.startsWith('/twin') || u.startsWith('/_design');
const CODE = /FFG-[A-Z]+-\d|\bIF-\d|\bD0\d-\d|보고서 \d|§\d/;
/** 헤드라인 값 — 숫자·비율·분수·시간, 아직 모름(—) */
const KEY_VALUE = /^(?:[—…]|[+−-]?\d[\d,.]*\s*(?:%|s|ms|분|건|개|대|일)?(?:\s*\/\s*\d[\d,.]*)?)$/;
const ZERO = /^0+(?:\.0+)?\s*(?:%|건|개|대)?(?:\s*\/\s*\d+)?$/;

async function threeSeconds(page: Page, url: string) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(url);
  await expect(page.locator('#main h1').first()).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);

  const key = page.locator('#main [data-key-message]');
  await expect(key, '핵심 메시지는 화면마다 정확히 1개').toHaveCount(1);
  await expect(key).toBeVisible();
  const box = (await key.boundingBox())!;
  expect(box.y, '핵심 메시지는 첫 화면 위쪽(320px 안)').toBeLessThan(320);

  const sizes = await page.evaluate(() => {
    const px = (e: Element) => parseFloat(getComputedStyle(e).fontSize);
    const k = document.querySelector('#main [data-key-message]')!;
    const keyMax = Math.max(...[k, ...k.querySelectorAll('*')].map(px));
    const h1 = px(document.querySelector('#main h1')!);
    // 핵심 메시지 밖에서 실제로 글자를 그리는 보이는 요소 중 가장 큰 글자
    let other = 0;
    let who = '';
    for (const e of document.querySelectorAll('#main *')) {
      if (k.contains(e) || e.closest('svg, canvas, [aria-hidden="true"]')) continue;
      const own = [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!own) continue;
      const r = (e as HTMLElement).getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') continue;
      if (px(e) > other) (other = px(e)), (who = `${e.tagName}.${(e as HTMLElement).className} "${e.textContent!.trim().slice(0, 30)}"`);
    }
    return { keyMax, h1, other, who };
  });
  expect(sizes.keyMax, '핵심 메시지 글자가 H1보다 크다').toBeGreaterThan(sizes.h1);
  expect(sizes.keyMax, `핵심 메시지가 화면에서 가장 큰 글자 — 더 큰 것: ${sizes.who}`).toBeGreaterThanOrEqual(sizes.other);

  await expect(page.locator('#main .ds-page .ds-eyebrow'), '머리에 추적 코드 머리표 없음').toHaveCount(0);
  await expect(page.locator('#main .ds-kpis'), 'KPI 타일 줄 없음 — 요약 한 줄(SummaryLine)로').toHaveCount(0);

  for (const lead of await page.locator('#main .ds-page__lead').allTextContents()) {
    expect(lead.length, `머리 설명은 한 줄(70자 이하): ${lead}`).toBeLessThanOrEqual(70);
    expect(lead, `머리 설명에 코드·보고서 절 번호 없음: ${lead}`).not.toMatch(CODE);
  }

  // ⑦ 핵심 메시지 문장·행동 링크를 본문에서 글자 그대로 되풀이하지 않는다(2026-10-17 Learn 허브 카드 제목·정책 상세 빈 검증 안내에서 발견)
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

  // ⑧ 헤드라인 한 패턴 — /policies/:id DEPLOYED·/products/:id/:ver DEVELOPING 같은 거대 상태어, 데이터 없는 초록(2026-10-23 하네스 2판)
  const head = await page.evaluate(() => {
    const k = document.querySelector('#main [data-key-message]')!;
    const text = k.querySelector('.ds-key__text');
    return {
      tone: k.getAttribute('data-tone') ?? '',
      value: k.querySelector('.ds-key__value')?.textContent?.trim() ?? null,
      textColor: text ? getComputedStyle(text).color : '',
      ink: getComputedStyle(document.querySelector('#main')!).color,
      status: [...k.querySelectorAll('.ds-key__status')].map((e) => e.getAttribute('data-tone') ?? ''),
    };
  });
  expect(['ok', 'warn', 'danger', 'neutral'], `헤드라인 톤은 ok·warn·danger·neutral: ${head.tone}`).toContain(head.tone);
  for (const t of head.status) expect(['ok', 'warn', 'danger', 'neutral'], `상태 pill 톤: ${t}`).toContain(t);
  if (head.value != null) {
    expect(head.value, `헤드라인 큰 값은 숫자 — 낱말 상태는 status pill로: "${head.value}"`).toMatch(KEY_VALUE);
    if (ZERO.test(head.value)) expect(head.tone, `값이 0이면 neutral: "${head.value}"`).toBe('neutral');
  }
  expect(head.textColor, '헤드라인 문장 글자는 본문색 — 판정 색은 숫자·pill·표식에만').toBe(head.ink);

  const h1 = (await page.locator('#main h1').first().innerText()).trim();
  expect((await page.locator('.sh-trail li').allInnerTexts()).map((t) => t.trim()), '경로 표시는 H1을 되풀이하지 않는다').not.toContain(h1);
}

for (const m of MENU_ENTRIES.filter((x) => !SKIP(x.menu))) test(`3초: ${m.title} (${m.menu})`, ({ page }) => threeSeconds(page, m.menu));
for (const d of DRILLDOWNS.filter((x) => !SKIP(x.url))) test(`3초(하위): ${d.title} (${d.url})`, ({ page }) => threeSeconds(page, d.url));
