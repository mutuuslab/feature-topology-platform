// 3초 테스트 공통 규칙 — three-second.spec(메뉴·하위 화면)과 home.spec(역할별 홈)이 함께 쓴다(UX3-15, 2026-10-24).
//   ⑨ 본문 코드(bodyCodes) — 보이는 글자와 못 누르는 버튼의 이유 글자(.ds-btn-why__text)에 규칙·컴포넌트 코드 없음.
//      2026-11-04 하네스 리뷰 F3: 직무 분리 코드(SOD-13)·업무 절차 번호(FPW.14)·설계 결정(D-REF-6)·오류 코드(REFDB_*)가 버튼 이유로 보였다
//   ⑪ 요약 줄(SummaryLine) 항목이 핵심 메시지를 되풀이하지 않는다 — 홈 '내 차례 0' 옆에 '내 차례인 검토가 없습니다'.
//      이름이 핵심 메시지 문장에 들어 있고, 값도 같거나(핵심 숫자 = 요약 숫자) 핵심 메시지에 숫자가 없으면 반복이다.
//      핵심 합계를 나눈 내역(Topology '5 미판정·FAIL' 옆 FAIL 2·미판정 3)은 새 정보라 허용.
//      상태 pill(.ds-key__status)도 본다 — Feature DB 'pill 발행 대기 2' 옆 요약 줄 '발행 대기 2'(F10). pill은 낱말 상태('발행 대기 있음')
//   ⑫ 본문(#main)에 어두운 배포 및 모니터링 구역(data-zone="ops") 없음 — 대시보드 히어로가 화면에서 가장 진한 요소가 되어 핵심 메시지를 눌렀다.
//      배포 및 모니터링 톤은 로그인 절차 모션에만 쓴다(design/tokens.css)
import { expect, type Page } from '@playwright/test';

/** 머리 설명·본문에 쓰면 안 되는 코드 — 요구 ID(FFG-)·연계(IF-)·컴포넌트(D01-01)·보고서 절 번호 */
export const CODE = /FFG-[A-Z]+-\d|\bIF-\d|\bD0\d-\d|보고서 \d|§\d/;
/**
 * ⑨ 본문 코드 — CODE + 따라하기 시나리오 코드(CS-01·CLASSIFY-GATE·KILL-DC2) + 직무 분리·업무 절차·설계 결정·Feature DB 오류 코드.
 * REFDB_는 오류·막힘 코드(REFDB_LINK_BLOCKED 등)만 — 감사 동작 이름(REFDB_CHANGE_CREATE·REFDB_RELEASE_PUBLISH·REFDB_ADD_REQUEST·REFDB_SOURCE_REVIEW·시드 가져옴 REFDB_SEED)은
 * 감사 이력의 동작 열에 FEATURE_* 동작과 같이 데이터로 보인다
 */
export const BODY_CODE = new RegExp(String.raw`${CODE.source}|\bCS-\d|\bCLASSIFY-GATE\b|\bKILL-DC\d|\bSOD-\d|\bFPW\.\d|\bD-REF-\d|\bREFDB_(?!(?:CHANGE|RELEASE|ADD|SOURCE)_|SEED\b)[A-Z_]+`);

/** ⑨ 본문(#main)에 보이는 코드 — 설명 모드(.ds-explain·.ds-page__codes)·title 툴팁·원시 데이터(pre)·접힌 내용은 뺀다. 버튼 이유 글자는 늘 본다 */
export async function bodyCodes(page: Page): Promise<string[]> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const out: string[] = [];
    const main = document.querySelector('#main')!;
    // .ds-error__code — 오류 상자의 오류 코드는 문의용으로 보인다(전역 정책, ErrorNote showsCode)
    // .jd-key — Jira식 대시보드의 키 열(이슈 키). 업무 절차 활동 ID(FPW.1-A01)가 Feature ID처럼 키로 보인다(사용자 결정 Jira식 대시보드)
    const HIDDEN = '.ds-explain, .ds-explain-block, .ds-page__codes, .ds-error__code, .jd-key, [aria-hidden="true"], svg, canvas, script, style, option, pre, details:not([open]) > :not(summary)';
    const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent!.trim();
      const el = n.parentElement;
      if (!t || !el || !re.test(t) || el.closest(HIDDEN) || el.closest('.ds-btn-why__text')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      if (![...range.getClientRects()].some((r) => r.width && r.height) || getComputedStyle(el).visibility === 'hidden') continue;
      out.push(`${el.tagName}.${el.className} "${t.slice(0, 50)}"`);
    }
    // 못 누르는 버튼의 이유 — 버튼 아래 흐름 밖(absolute)에 그려 잘린 칸에서도 읽힌다(aria-describedby). 크기와 상관없이 본다
    for (const el of main.querySelectorAll('.ds-btn-why__text')) {
      const t = (el.textContent ?? '').trim();
      if (t && re.test(t) && !el.closest(HIDDEN)) out.push(`버튼 이유 "${t.slice(0, 50)}"`);
    }
    return out;
  }, BODY_CODE.source);
}

/** ⑪ 요약 줄 되풀이 — 핵심 메시지 문장과 상태 pill 각각 */
export async function summaryRepeats(page: Page): Promise<{ key: string; repeated: string[] }> {
  return page.evaluate(() => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const key = norm(document.querySelector('#main [data-key-message] .ds-key__text')?.textContent);
    const keyValue = document.querySelector('#main [data-key-message] .ds-key__value')?.textContent?.trim() ?? null;
    const pills = [...document.querySelectorAll('#main [data-key-message] .ds-key__status')].map((e) => norm(e.textContent));
    const repeated: string[] = [];
    for (const item of document.querySelectorAll('#main .ds-summary > span')) {
      const b = (item.querySelector('b')?.textContent ?? '').trim();
      const label = norm((item.textContent ?? '').replace(b, ''));
      if (label.length < 2) continue;
      if (key.includes(label) && (keyValue == null || keyValue === b)) repeated.push(`"${label}" ${b}`);
      // pill이 요약 항목의 이름과 값을 함께 말한다 — 같은 수를 두 번 읽힌다
      for (const p of pills) if (b && p.includes(label) && p.replace(label, '').includes(b)) repeated.push(`pill "${p}" = 요약 "${label}" ${b}`);
    }
    return { key, repeated };
  });
}

export async function summaryAndZone(page: Page) {
  const r = await summaryRepeats(page);
  expect(r.repeated, `⑪ 요약 줄 항목을 핵심 메시지 "${r.key}"(문장·상태 pill)에서 되풀이한다`).toEqual([]);
  const darkZones = await page.locator('#main [data-zone="ops"]').count();
  expect(darkZones, '⑫ 본문에 어두운 배포 및 모니터링 구역(data-zone="ops")이 있다 — 핵심 메시지보다 진한 장식이 된다').toBe(0);
}
