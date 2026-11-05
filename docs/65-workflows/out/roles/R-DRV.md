---
id: WF-ROLE-DRV
type: workflow
title: "도메인 검토자 업무 절차서 / Domain Reviewer Procedure"
status: draft
version: 0.2.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-14
last_updated: 2026-11-05
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-DRV · 도메인 검토자 업무 절차서

> 담당 도메인 기준 행의 변경 요청에 동의·보완·반대 의견을 준다.

- IAM 역할: DOMAIN_REVIEWER(도메인 검토자)
- IAM 데모 계정: approver
- 매핑 근거: 보고서 어휘 밖. Feature DB 설계(30-95) 8.1절 IAM DOMAIN_REVIEWER(도메인 범위는 계정 속성), 데모 계정 approver

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.14-A02 자동 점검·도메인 검토 — 수행·책임
- 프로세스: FPW.14 Feature DB 운영
- 시작: 앞 활동 완료
- 입력: WP-REF-CHANGE-REQ, WP-REF-ADD-REQ → 출력: WP-REF-REVIEW
- 플랫폼: `reviewRefChange`, `/master/feature-db/changes/:id`, `/master/feature-db/changes`
1. 자동 점검 결과에서 ID 형식·필수 정보·출처·규모 근거·중복·선행 관계 항목을 확인한다
2. 필수 정보 누락은 요청자에게 보완을 요청하고, 그 밖의 실패 항목은 보완 필요로 표시한다
3. 담당 도메인의 기준으로 변경 내용을 검토해 동의·보완·반대 의견과 근거를 남긴다
4. 대표 ASIL을 바꾸는 요청이면 Safety Manager 의견을 받아 함께 적는다
- [ ] 검토 의견이 비어 있지 않고 검토자가 요청자와 다른 사람이다
- [ ] 필수 정보 누락 항목이 남아 있지 않다

## 2. 협의·통보 받는 활동

- FPW.1-A06 Feature DB 추가 요청 (협의)
- FPW.14-A01 변경 요청 작성 (통보)
- FPW.14-A03 변경 승인·반려 (협의)
- FPW.14-A04 Feature DB 버전 발행 (통보)
- FPW.14-A05 출처 정기 점검 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
