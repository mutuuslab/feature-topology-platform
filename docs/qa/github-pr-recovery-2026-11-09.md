---
id: TC-GITHUB-PR-RECOVERY-2026-11-09
type: reference
title: "GitHub Flag PR 부분 실패 복구"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# GitHub Flag PR 부분 실패 복구

기준: RC `c799a0e9`, 분리 브랜치 `feat/github-recovery-20261109`. 실제 회사 GitHub나 새 운영 연결을 사용하지 않고 기존 `tools/flag-code/mock-github.ts`와 실제 로컬 HTTP transport를 사용했다. 개인키·토큰은 시험 안에서 생성·보관하며 로그에 출력하지 않는다.

## 문제와 보완

기존 구현에서 refs POST는 성공하고 pulls POST만503으로 실패하도록 했다. 다음 호출은 refs POST를 반복해422 `Reference already exists`로 실패했다. 새 HTTP 재현 시험이 수정 전 실제로 실패했다.

수정은 PR 입력의 정규화된 의도 SHA-256을 커밋 메시지에 기록한다. 재시도는 기존 브랜치의 정확한 의도·단일 부모·예상 전체 tree를 확인하고 원래 커밋을 재사용한다. 기본 브랜치가 전진했다면 원래 부모가 현재 기준 이력의 조상인지 compare API로 확인한다. 다른 커밋·파일·의도는409로 거부한다. 기존 refs의 PATCH/PUT/DELETE·force 갱신은 하지 않는다.

같은 저장소의 정확한 head/base로 open PR을 조회하고 head SHA·저장소·제목·본문·URL까지 확인한다. 이미 열린 PR 또는 POST 응답 유실로 만들어진 PR은 같은 번호로 회복한다. 모호한 복수 결과·다른 의도는 새 POST 없이 거부한다. 권한403은 회복 성공으로 바꾸지 않으며 기존401 토큰 갱신·만료 검증·redirect 거부를 유지한다.

모의 GitHub에는 실제 REST 형태의 open PR 조회/필터, 중복 PR422, 부모 이력 compare를 추가했다. 고장 주입은 시험의 HTTP proxy에만 있으며 제품 어댑터의 성공값을 가짜로 바꾸지 않는다.

## 실제 검증

- 수정 전 신규 HTTP 재현1건 FAIL: 재시도 refs POST422.
- 자체 contracts 빌드 PASS, backend `tsc -p tsconfig.build.json` PASS.
- 영향4파일56시험 PASS: 신규 복구·기존 transport·Flag code·Flag code hardening. 이후 동시 요청과 최근PLANNED409 단언을 추가해 신규 파일21시험 PASS. 마지막에 전체4파일을 다시 실행한 수치로 합산하지 않는다.
- 신규21시험: PR503 후 같은 SHA로 재개·main 전진, PR/ref 응답 유실, refs 생성 경합, 파일 순서 정규화·삭제·기존 파일 보존, 동시 호출1PR, foreign commit/의도/tree/기준이력 거부, PR의 SHA/저장소/base/제목/본문/URL 불일치 거부, 복수 조회 거부, 조회 중 branch 변경, 권한403·원문 비노출,401 갱신, native FAILED/PLANNED 복구.
- native HTTP: 권한 없는 역할403 → PR생성503으로 FAILED 저장 → 같은 POST로 동일prId OPEN → 최근PLANNED409 → 오래된PLANNED를 같은PR번호로 회복 → GET재조회1건. 원래 브랜치SHA 유지·refs POST1회·실제 생성PR1개.

실행 명령(백엔드 디렉터리):

```text
node ../node_modules/vitest/vitest.mjs run test/d01/github-pr-recovery.spec.ts test/d01/github-transport-hardening.spec.ts test/d01/flag-code.spec.ts test/d01/flag-code-hardening.spec.ts --maxWorkers 1
node ../node_modules/vitest/vitest.mjs run test/d01/github-pr-recovery.spec.ts --maxWorkers 1
node ../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

## 경계와 후속

의도 표식이 없는 예전 임의/legacy 브랜치는 자동 인수하지 않는다. 사람이 원문 커밋·파일·기존 PR을 확인하는 별도 정합 작업이 필요하며, 이 변경이 기존 브랜치를 강제로 덮어쓰지는 않는다. 원격 브랜치가 조회 이후 다른 작성자에 의해 변할 수 있어 마지막 ref 확인과 PR 응답 SHA 확인으로 탐지한다. 원격 브랜치 잠금이나 merge는 수행하지 않는다.

현재 자동 PR은 `feature.lifecycle.changed`의 onPublish → db.afterCommit → autoPr 직접 호출이다. 기존 PR 행이 있으면 autoPr가 반환한다. 이 작업은 새 outbox scheduler나 자동 백그라운드 재시도를 추가하지 않았다. 기존 API의 FAILED/10분 초과 PLANNED 재개를 안전하게 마친다.

## 수동 재개 UI 후속

오래된 PLANNED가 PR_OPEN으로 분류되면 화면은 비활성 시연 병합만 제공했다. 또한 기존 생성 버튼은 현재 행의 Flag 하나를 보냈으므로 원래 자동 PR의 전체 Flag·본문과 달라질 수 있었다. 현황·대사·상세와 제거 PR 수명관리에서 원본 prId를 조회해 같은 저장소·Feature/version·전체 Flag·Retirement를 재사용하는 수동 재개를 연결했다. backend와 UI는 같은 순수 10분 초과 규칙을 사용하고 최근 PLANNED·조회 미완료·비활성 저장소·권한 부족은 설명과 함께 차단한다. 시간 경과 시 버튼을 다시 평가한다.

API 응답 유실/일시 오류는 성공을 추측하지 않는다. 다시 GET한 목록에서 동일prId·저장소·Feature/version·kind·branch·Flag 집합의 OPEN/번호/URL을 확인해야 회복 성공을 표시하고 coverage를 갱신한다. 401/403은 이 경로로 성공 처리하지 않는다. 201 FAILED는 실패이며 재개할 수 있고, 읽기 실패에는 상태 재조회 버튼을 제공한다. KO/EN 문구를 함께 추가했다.

후속 실제 실행: 프런트2파일31시험 PASS(신규10·기존18+메뉴별 POST연결3), backend2파일30시험 PASS(복구21+기존hardening9). contracts 빌드·frontend noEmit·backend build PASS. 첫 UI 시험의7실패는 로딩 때 교체된 예전 disabled DOM node를 잡은 시험 오류였으며 재렌더된 버튼을 다시 조회하도록 수정했다. 실제 브라우저 확인은 이 UI checkpoint 뒤 별도 기록한다.

첫 프로덕션 Chromium 실행에서 API 응답 유실 후 native OPEN 재조회 자체는 성공했지만 coverage 갱신이 재개 버튼을 제거하면서 확인 문구가 같이 사라졌다. 검증된 성공은 전역 상태 토스트에도 남겨 화면 상태가 바뀐 뒤 확인할 수 있게 보완했다. 보완 후 수동 재개10시험 PASS. native 알림 SSE는 지속 연결이므로 브라우저의 networkidle만 기다리면 끝나지 않는다. 제한된 idle 확인 뒤 실제 PR 요청/상태 DOM을 기다리는 방식으로 검증한다.

## 최종 프로덕션 브라우저 증거

프런트 원천 `488c27214dd1f1a3c76241efb47924ea1425a99c`의 `dist-github-recovery-20261109-r3`와 native `e129327e`의 독립 메모리 API를 실제 Chromium으로 연결했다(두 커밋 사이 backend 차이는 없고 UI 알림/QA만 추가). API9606·UI9607·시험 제어9608은 기존 사용자 서버와 별개였다. 회사 데이터/운영 GitHub 대신 기존 App/JWT HTTP 데모를 사용했다. 제어 경로는 수동 시험 runner에만 있고 제품에는 추가하지 않았다.

- FAILED 재개, 최근PLANNED 차단, 오래된PLANNED 기존PR 회복, **native POST가201로 완료된 뒤 브라우저 응답만 끊기**와 GET회복, 영어 읽기계정 차단을 확인했다.
- 최종 브라우저의 실제POST3건 모두 같은 repoId/Feature/version·Flag2개를 유지했다. native 보존 브랜치SHA 동일, 실제생성PR1개, 전체 보존 데모의 refs POST1회·pulls POST2회(초기503 포함). 자동 force·merge·새회사연결 없음.
- 1366/390px 가로넘침0, pageerror0. 모바일 재개 안내·버튼과 회복 토스트 스크린샷을 실제로 열어 확인했다. 의도한 응답 끊김은 별도 고장 주입이며 HTTP 오류0이라고 주장하지 않는다.
- 첫 임시 runner의240초 제한 종료는 증명 완료로 세지 않았고, 재실행 runner가 최종1/1 PASS를 확인했다. 프런트 프로덕션 build PASS. 전체 플랫폼/정적 corpus 예산/Publish 검증은 이 작업 범위가 아니다.

키트 증거: `C:/project/2026-09-23_FF_IMP/out/github-recovery-20261109/`의 `browser.py`, `browser-results.json`, `native-results.json`, `native-browser-runner.spec.ts`, `build-r3.log`, `planned-stale-390.png`, `response-recovered-390.png`, `viewer-en-390.png`. runner는 필요할 때 분리 WT의 `backend/test/d01/`에 복사해 같은 backend Vitest 설정으로 실행하는 수동 증명용이다. 제품 자동 시험에 포함하지 않는다. 임시 native 서버는 runner 종료 시 닫았으며 사용자9543/API9570·다른 작업의9580은 건드리지 않았다.

계약 대조: [GitHub 정확한 ref 조회](https://docs.github.com/en/rest/git/refs#get-a-reference), [open PR head/base 필터](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests), [커밋 비교](https://docs.github.com/en/rest/commits/commits#compare-two-commits). 이 검증은 기존 데모의 실제 HTTP 실행이며 회사 운영 GitHub 검증·전체 플랫폼 하네스·Publish 완료 판정이 아니다.
