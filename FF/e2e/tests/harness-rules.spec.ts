// 하네스 점검이 실제로 잡는지 — 일부러 망가뜨린 화면(page.setContent)에서 규칙이 실패를 내야 한다(2026-11-04 하네스 리뷰 F3·F10·H9).
//   ⑨ bodyCodes: 못 누르는 버튼 이유 글자의 직무 분리 코드(SOD-14)·업무 절차 번호(FPW.14)·설계 결정(D-REF-6)·오류 코드(REFDB_*)
//   ⑪ summaryRepeats: 핵심 메시지 상태 pill이 요약 줄 항목(이름 + 값)을 되풀이
//   settle: 끝나지 않는 로딩·오류 상자는 시간 초과를 삼키지 않고 실패
import { expect, test } from '@playwright/test';
import { bodyCodes, summaryRepeats } from './key-message-rules';
import { settle } from './settle';

const page = (main: string) => `<!doctype html><html lang="ko"><body><main id="main">${main}</main></body></html>`;
const key = (pill: string) => `<div data-key-message data-tone="warn"><span class="ds-key__value">1,052</span><span class="ds-key__text">기준 행</span><span class="ds-key__status" data-tone="warn">${pill}</span></div>`;
const summary = `<p class="ds-summary" role="group"><span>활성 <b>995</b></span><span>발행 대기 <b>2</b></span></p>`;
const why = (text: string) => `<span class="ds-btn-why"><button disabled>검토 의견 보내기</button><span class="ds-btn-why__text" style="position:absolute;width:0;height:0;overflow:hidden">${text}</span></span>`;

test('⑨ 버튼 이유 글자의 내부 코드를 잡고, 문장만이면 통과한다', async ({ page: p }) => {
  for (const code of ['(SOD-14)', 'FPW.14-A05', 'D-REF-6', 'REFDB_LINK_BLOCKED']) {
    await p.setContent(page(why(`변경 요청자는 자기 요청을 검토할 수 없습니다 ${code}`)));
    expect(await bodyCodes(p), code).toHaveLength(1);
  }
  await p.setContent(page(why('변경 요청자는 자기 요청을 검토할 수 없습니다')));
  expect(await bodyCodes(p)).toEqual([]);
  // 오류 상자의 오류 코드는 문의용으로 보인다(전역 정책) — 잡지 않는다
  await p.setContent(page('<div class="ds-error" role="alert"><strong>등록하지 못했습니다</strong><span class="ds-error__code">REFDB_DUPLICATE_IN_SCOPE</span></div>'));
  expect(await bodyCodes(p)).toEqual([]);
  // 감사 동작 이름·Jira식 대시보드의 키 열은 데이터·식별자다 — 잡지 않는다. 본문 문장의 오류 코드는 잡는다
  await p.setContent(page('<table><tr><td><span class="ds-mono">REFDB_CHANGE_CREATE</span></td><td><a class="jd-key" href="#">FPW.14-A01</a></td></tr></table>'));
  expect(await bodyCodes(p)).toEqual([]);
  await p.setContent(page('<p>REFDB_LINK_BLOCKED — 기준 행을 연결하세요</p>'));
  expect(await bodyCodes(p)).toHaveLength(1);
});

test('⑪ 상태 pill이 요약 줄 "발행 대기 2"를 되풀이하면 잡고, 낱말("발행 대기 있음")이면 통과한다', async ({ page: p }) => {
  await p.setContent(page(key('발행 대기 2') + summary));
  expect((await summaryRepeats(p)).repeated).toEqual(['pill "발행 대기 2" = 요약 "발행 대기" 2']);
  await p.setContent(page(key('발행 대기 있음') + summary));
  expect((await summaryRepeats(p)).repeated).toEqual([]);
});

test('settle — 끝나지 않는 로딩과 오류 상자는 실패한다', async ({ page: p }) => {
  await p.setContent(page('<div data-state="ready">표</div>'));
  await settle(p, { timeout: 500 });
  await p.setContent(page('<div class="ds-skel" data-state="loading" aria-busy="true"></div>'));
  await expect(settle(p, { timeout: 500 })).rejects.toThrow(/로딩이 500ms 안에 끝나지 않았다/);
  await p.setContent(page('<div class="ds-state" data-state="error" role="alert">불러오지 못했습니다</div>'));
  await expect(settle(p, { timeout: 500 })).rejects.toThrow(/오류 상자/);
  // 오류 화면 자체를 보는 시험은 errors: null
  await settle(p, { timeout: 500, errors: null });
});
