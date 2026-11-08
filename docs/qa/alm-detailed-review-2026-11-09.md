---
id: TC-ALM-DETAILED-REVIEW-2026-11-09
type: reference
title: "CodeBeamer·Jira·GitHub 상세 연계 검토"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# CodeBeamer·Jira·GitHub 상세 연계 검토

사용자 지정 범위는 기존에 구성한 **데모**다. 기존 `/external.html?system=codebeamer|jira` 작업 창, DB에 저장되는 MockExtStore, 독립 HTTP Jira/CodeBeamer 참조 서버(`tools/ext-mocks`), GitHub App·OIDC·webhook 시험 서버(`tools/flag-code/mock-github.ts`)와 기존 실제 GitHub 작업 저장소를 사용한다. 회사 운영 계정 신규 연결을 게시 선행조건으로 만들지 않는다.

## 확인한 결함과 수정

| 영역 | 문제 | 보완 |
|---|---|---|
| CodeBeamer 요구 연결 | 같은 Requirement ID의 여러 결과에서 첫 항목을 임의 선택 | total/items 중복을 거부. 기존 데모 저장소도 동일하게 적용 |
| Jira Cloud 조회 | 빈 페이지에 반복 커서가 있으면 반복하거나 조회 한도를 부분 성공으로 반환 | 반복·없는 다음 커서·비종료 한도를 명시 오류로 처리 |
| Jira Data Center 조회 | 서버가 요청100보다 작은 페이지를 반환하면 남은 항목을 누락 | 실제 반환 개수/total/maxResults로 다음 페이지 계산 |
| Jira 변경 이력 | 최근100건만 읽으면 그 앞 사람 전이를 잃을 수 있음 | Cloud 변경 이력을 페이지별로 읽음. v2 잘린 expand 이력은 완료로 처리하지 않음 |
| 호출 제한 | Retry-After120초를5초로 줄여 재호출 | 긴 대기는 durable outbox로 넘기고 외부 시각보다 먼저 재시도하지 않음 |
| 오류 처리 | HTML401이 JSON 구문 오류로 바뀜 | HTTP 인증 오류를 보존하고 응답 원문을 제품 오류에 노출하지 않음 |
| GitHub 토큰 | 누락·빈 값·잘못된 만료를 문자열로 저장 | 값과 유효기간을 검증. 취소된 캐시는401에서한번 새로 받고 재호출 |
| 자격 증명 전달 | 기본 redirect로 다른 경로를 따라갈 수 있음 | 인증 요청의 redirect를 거부 |

공식 계약은 [Atlassian 검색·대사](https://developer.atlassian.com/cloud/jira/platform/search-and-reconcile/), [CodeBeamer Tracker Item Operations](https://support.ptc.com/help/codebeamer/r3.1/en/codebeamer/developers_guide/swagger/11375769.html), [GitHub App 설치 토큰](https://docs.github.com/en/rest/apps/apps)과 대조했다. 제품별 현재 문서와 기존 데모 모형의 실행 근거를 구분한다.

## 실제 검증

- 신규/영향5파일37 PASS: HTML401·비정상 JSON·요구ID중복·cursor반복/불완전·server-capped페이지·Retry-After·demo중복거부·실제outbox3일지연·GitHub 잘못된 토큰4종/401갱신/원문비노출·기존GitHub Flag PR 보강.
- 넓힌 27파일233시험은 최초226 PASS/7 FAIL + worker EOF2를 확인했다. 7실패는 새G6협력사 검수 선행조건을 갖추지 않은기존3파일의양성흐름/연쇄실패였다. 응답본문으로 SUPPLIER_PACKAGE/G6를 확인했다.
- 양성 fixture에 실제 native 합성10본문·hash·다른검수자 및G6판정을 선행했다. 코드검사 waiver를 쓰기 전 협력사 gate도실제통과해야 한다. 기존문자열expected를넓히거나권한을추가하지 않았다.
- 해당3파일과 SW원문8case를 통합해 **4파일86 PASS** (`out/resume-20261107/alm-prerequisite-r3.log`). 최초 넓힌 실행을 전체PASS로 보고하지 않는다. 잔여 worker EOF의 독립 재확인과 최종 통합 전수 재시험은 별도다.
- 실제 GitHub PR#9를 connected API로 조회: open/mergeable, head `08cd4cc`·24commits·725changedfiles. 현재 RC 후속은 이 원격 PR의 코드라고 주장하지 않는다. 최종 게시 때 정확한 RC source를 별도 고정한다.

## 후속 수락

기존 standalone 창의 새 영어/의견 입력 보존·권한·상태 전이, 동일source 실제 브라우저의 등록→요구·Epic→Story/Task→코드/PR→Gate/정책·SW다운로드 교차흐름을 재검증한다. GitHub 다단계 PR 생성 중 브랜치 생성 후 실패의 재시도 복구도 별도 점검 대상으로 남긴다. 이 문서는 연계 전체/전체 플랫폼/최종 Publish 완료 판정이 아니다.
