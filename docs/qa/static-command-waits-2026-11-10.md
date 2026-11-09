---
id: TC-STATIC-COMMAND-WAITS-2026-11-10
type: reference
title: "정적 업무 명령 완료 대기 기준 검토"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-10
---

# 정적 업무 명령 완료 대기 기준 검토

## 판정과 변경 범위

기본 Playwright `expect` 5초를 제품의 정적 명령 SLA로 해석한 판단을 정정한다. `FF/harness/budgets.json`에는 해당 5초 명령 SLA가 없고, 기존 정책 승인 시험도 실제 병렬 부하를 근거로 명령 완료에 20초를 사용한다. 독립 하네스 검토와 아래 실측을 근거로 한 기능 시험의 대기 기준 정정이다. 제품 성능 해결이나 과거 실패의 재분류가 아니다.

실제 지연을 확인한 다음 다섯 assertion에만 최대 20초를 지정한다. 임의 sleep이나 전역 expect 변경은 없다.

| 명령 | 여전히 요구하는 실제 완료 상태 |
| --- | --- |
| 상품 새 Version 생성 | 새로 생성된 정확한 Catalog Version 상세 URL |
| 첫 Canary 배포 | 실제 서명·게시 명령 완료 후 서랍 닫힘, DEPLOYED/5% 상태 |
| 복구 기준판/동일값 새 판 배포 helper | 같은 실제 명령 서랍 닫힘과 DEPLOYED |
| Release Sign-off | 실제 서명 정보와 서명 액션 제거, 이후 출시·알림·감사 |
| Feature DB 변경 요청 생성 | 생성 CR ID, 독립 검토·승인·서명 완료·업무 인계 |

각 시험 전체 240/180/420초, CI 2workers, 명시적 publication `5000`ms 상태 확인, 렌더링·프레임 성능 예산, 권한/직무 분리, 거부·서명·영속·최종 UI 단언은 유지한다. 제품 처리 코드는 이 변경에 포함하지 않는다.

## 보존된 실패와 계측

원본 r4는 app `786043d9e860d1b9ae359bcd9cb8f9a00c53566d`, 단일 native `70bbccd08e4156d7431406c1b739d73baaf90e23`/9793의 진단 preview9805다. 7흐름/2worker는 **4 PASS/3 FAIL**, skip/flaky0, 2.8분이다. 상품 첫 생성 URL/첫 정책 준비판 배포/Release Sign-off 액션 제거의 기본5초 실패를 그대로 보존했다. 시작·종료 하네스7파일 SHA 차이0 및 release 동일을 확인했다. 최종 fresh capture나 공개 게시 검증이 아니다.

같은 진단판에서 응답·asset·저장 상태를 바꾸지 않는 QueryClient observer로 별도 계측했다. 2workers, 원5초 단언의 표적3명령은 3 PASS/43.2초였다. 5초 이후10초 추가 관측은 진단용으로만 기록하며 원단언 실패를 통과로 바꾸는 용도로 쓰지 않는다.

| 명령 | 실 write 반환 | mutation success | 반환 후 조회/성공까지 |
| --- | ---: | ---: | ---: |
| 상품 Version | 3.596초 | 3.615초 | 0.019초 |
| 첫 기준판 배포 | 2.887초 | 3.057초 | 0.169초 |
| 출시 서명 | 2.140초 | 4.075초 | 1.935초 |

앞서 REFDB 생성도 write4.36초 및 기본5초 실패가 보존돼 있다. 병렬 cold 준비·명령 처리·실조회 갱신의 변동이 있으므로 고정 sleep 대신 실제 완료 상태를 bounded wait한다. 전역 mutation onSuccess 대기 제거, fake optimistic 완료, guard 완화는 하지 않는다.

증거는 시연 KIT `out/static-business-final-r4/`(원본 보고서·로그·시작끝 SHA), `out/command-latency-9805-r1/`(실제 명령 event·URL·본문·PNG), `out/mutation-phase-two-workers-r2/`(REFDB 원계측)에 보존한다. 변경 후 동일한 원7흐름/2worker는 새 실행으로 기록한다. 첫 대기 기준 변경 작성 시점에는 미실행이었으며, 후속 실행은 아래에 분리 기록한다.


## 후속 원7 실행과 읽기·롤백 완료 대기

첫 대기 기준 정정 후 원7/2worker r5는 **4 PASS/3 FAIL/3.1분**, skip/flaky0이다. 상품·체험·출시 Sign-off·기준 행 변경/업무 이관 전체는 통과했다. 더 진행한 두 정책 흐름의 롤백 실행/두 번째 미리보기와 기준 행 검색이 기본5초에서 실패했다. 시작·종료 하네스7파일 SHA 차이0 및 같은 preview release786을 확인했다. 이 실패도 원본 `out/static-business-final-r5/`에 보존한다.

응답·asset·업무 상태를 바꾸지 않는 별도2worker 계측은 롤백 execute **실write3.412초 → success3.579초 → 실제 실행됨**을 확인했다. 롤백 preview는 **실write5.004초 → success5.019초**로 원5초 실패를 재현했다. 원실패를 보존한 채 별도15.25초 관측에서 실제 적용 가능 결과를 확인했다. 두 명령 모두 관측된 QueryClient 오류0이다. 계측 전체는 2 PASS/1 FAIL이며 성공으로 재분류하지 않는다(`out/rollback-read-latency-9805-r1/`).

기존 롤백 승인 완료와 같은 원칙으로, 두 execute/두 preview assertion만 최대20초의 실제 상태 대기로 정정한다. 이후 실제 요청 ID·독립 반려/승인·서명 재게시·회신·최종 실행 이력과 오류 단언은 유지한다. 제품 처리 함수·권한·승인·판정 규칙은 수정하지 않는다.

기준 행 검색 실패의 화면은 실제 검색결과 progressbar였다. `RefPicker`는 입력을250ms debounce하고 정적 검색은200행씩 전체 목록을 받아 계산한다. 입력 직후 이전 query가 잠시 calm인 상태를 settle로 통과시키지 않도록, **정확한 기대 refID의 가져오기 버튼**을 기존 읽기 준비 예산15초 내 긍정 결과로 기다린 후 dialog settle(로딩 종료/오류0)을 확인한다. 그 뒤 동일한 기준 ID를 선택한다. 스냅샷·필터·업무 데이터나 DOM을 조작하지 않는다. 별도 정확 refID 계측은1.476초에 실제 버튼을 확인했고 오류0이었다.

전역 expect, 전체240/180/420초, CI2workers, 명시 publication5000ms, 성능 예산과 모든 최종 상태/거부/서명/영속 단언은 그대로다. 이 후속도 기능 시험 준비·완료 대기 정정이며 제품 성능 개선 주장과 구분한다.
