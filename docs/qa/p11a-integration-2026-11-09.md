---
id: TC-P11A-INTEGRATION-2026-11-09
type: reference
title: "사건별 차단·요청 접수·영향군·부분 복원 통합"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# 사건별 차단·요청 접수·영향군·부분 복원 통합

2026-11-09 / root. 원천 `gap/p11a@c8eba4a3`를 W2.1/P9/GX/AC 및 기존 업무/소프트웨어 전달과 통합했다. 원래 P11a WT의 세 tracked WIP는 diff 내용이 없는 EOL 상태로 관측해 추가 기능으로 복사하지 않았다.

외부 API-key 차단 요청과 이상 징후 조건 충족은 사람의 접수함에 기록하며 직접 차단하지 않는다. 사람의 차단 요청과 다른 두 승인자·게이트·서명·차량별 봉투는 기존 순서를 유지한다. 영향 차량은 후보/구성 미확인/통신 미수신을 구분하고 확정에는 분석 근거가 필요하다. 사건별 종료 차단과 선택 해제는 다른 사건을 유지하며 복원은 차단 사유 해소·원인 조치 확인·지정 승인·다른 두 사람 승인으로 진행한다. 활성 차단이 남아 있는 Feature의 새 정책 발행은 거부한다.

통합 시 GX 예외·서명된 Gate 근거와 활성 차단 거부를 함께 유지했다. W의 Feature epoch와 P9의 정책 TTL·독립 OTA 관측/직렬 읽기도 유지한다. 새 사건별 해제 `rescindKill`을 AC 계정 범위 명령 집합에 추가했고, 실제 지역 범위 밖 요청403/SCOPE_DENIED·markets를 기존 사건별 해제 scenario에 추가 검증했다. 새4개 migration231~234로 기존96잠금 SQL을 보존하여100개다. API 명세576경로, snapshotP11a는 실제 kills.items가 생성된 뒤 연결해 앞서 추가한 AC/W hook도 보존했다.

이번 실행(kit out):

| 범위 | 결과 | 로그 |
|---|---|---|
| P11a·기존 kill-v2·kill-conflict·AC scope4파일 | 34 PASS | p11a-native-tests.log |
| 사건별 해제 지역 범위 거부 추가 후 P11a15 case | 15 PASS | p11a-scope-regression-r2.log |
| 접수/영향/복원·범위 계약2파일 | 13 PASS | p11a-contract-tests.log |
| 사건·범위·관제·정적 엔진·OTA5파일 | 38 PASS | p11a-ui-tests.log |
| backend/frontend type | PASS | p11a-backend-type.log / p11a-frontend-type.log |

병합 시 두 알림 객체의 공통 닫힘 부분을 단순 합친 구문 오류를 발견해 GX 두 알림과 P11a 접수 알림을 각각 완전한 항목으로 보존했다. 계약 재빌드 후 위 시험을 실행했다. 범위 회귀 삽입용 로컬 스크립트의 처음 두 번은 들여쓰기 위치 검사에서 중단됐고 파일을 바꾸지 않았다. 실제 추가 후 로그는 r2다.

후속: 신규 native action의 업무 절차 binding/가이드·실 IAM 추출, P11a 정적 접수/영향 확정/선택 해제 동등성 및 generic 성공 fallback 배제, 신규 copy/계약 표시 영어, 최신2배 production 여러 case 및 팀별·이해관계자 리뷰/Publish. 기존38개 E2E 또는 이번 narrow PASS를 전체 완료로 확대하지 않는다.
