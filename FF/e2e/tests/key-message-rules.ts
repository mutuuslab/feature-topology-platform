// 3초 테스트 공통 규칙 — three-second.spec(메뉴·하위 화면)과 home.spec(역할별 홈)이 함께 쓴다(UX3-15, 2026-10-24).
//   ⑪ 요약 줄(SummaryLine) 항목이 핵심 메시지를 되풀이하지 않는다 — 홈 '내 차례 0' 옆에 '내 차례인 검토가 없습니다'.
//      이름이 핵심 메시지 문장에 들어 있고, 값도 같거나(핵심 숫자 = 요약 숫자) 핵심 메시지에 숫자가 없으면 반복이다.
//      핵심 합계를 나눈 내역(Topology '5 미판정·FAIL' 옆 FAIL 2·미판정 3)은 새 정보라 허용
//   ⑫ 본문(#main)에 어두운 관제실 구역(data-zone="ops") 없음 — 대시보드 히어로가 화면에서 가장 진한 요소가 되어 핵심 메시지를 눌렀다.
//      관제실 톤은 로그인 절차 모션에만 쓴다(design/tokens.css)
import { expect, type Page } from '@playwright/test';

export async function summaryAndZone(page: Page) {
  const r = await page.evaluate(() => {
    const k = document.querySelector('#main [data-key-message] .ds-key__text');
    const key = (k?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const keyValue = document.querySelector('#main [data-key-message] .ds-key__value')?.textContent?.trim() ?? null;
    const repeated: string[] = [];
    for (const item of document.querySelectorAll('#main .ds-summary > span')) {
      const b = item.querySelector('b')?.textContent ?? '';
      const label = (item.textContent ?? '').replace(b, '').replace(/\s+/g, ' ').trim();
      if (label.length >= 2 && key.includes(label) && (keyValue == null || keyValue === b.trim())) repeated.push(`"${label}" ${b.trim()}`);
    }
    return { key, repeated, darkZones: document.querySelectorAll('#main [data-zone="ops"]').length };
  });
  expect(r.repeated, `⑪ 요약 줄 항목을 핵심 메시지 "${r.key}"에서 되풀이한다`).toEqual([]);
  expect(r.darkZones, '⑫ 본문에 어두운 관제실 구역(data-zone="ops")이 있다 — 핵심 메시지보다 진한 장식이 된다').toBe(0);
}
