---
id: WF-ROLE-PO
type: workflow
title: "상품 Owner 업무 절차서 / Product Owner Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-7
    - WF-FPW-9
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-PO · 상품 Owner 업무 절차서

> 상품 구성과 고객 출시를 승인한다.

- IAM 역할: PRODUCT_APPROVER(상품 승인자)
- IAM 데모 계정: approver
- 매핑 근거: REPORT_APPROVER_ROLES PRODUCT_OWNER→PRODUCT_APPROVER

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.7-A06 상품 구성 승인 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-PRODUCT → 출력: WP-PRODUCT-APPROVAL
- 플랫폼: `productTransition`, `/products/:id/:ver`
1. 상품 작성자가 아닌 상품 Owner가 구성과 판매 조건을 검토한다
2. 승인하면 구성 승인 전이를 하고, 반려하면 사유를 남긴다
3. 고객 출시 승인은 구성 승인자와 다른 사람이 하도록 승인 후보를 지정한다
- [ ] 구성 승인자가 상품 작성자와 다르다

### FPW.7-A10 상품 고객 출시 승인 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: 앞 활동 완료
- 입력: WP-RELEASE-RECORD, WP-PRODUCT-APPROVAL → 출력: WP-PRODUCT-RELEASE
- 플랫폼: `productTransition`, `/products/:id/:ver`
1. 구성 승인자가 아닌 상품 Owner가 고객 출시를 승인한다
2. 플랫폼이 구성 승인자와 같은 사람의 승인을 거부하면 다른 승인자로 다시 승인한다
3. 출시 승인 결과를 상품 기획과 운영 조직에 알린다
- [ ] 고객 출시 승인자가 구성 승인자와 다르다

## 2. 협의·통보 받는 활동

- FPW.7-A05 상품 구성 작성 (통보)
- FPW.7-A12 Release Sign-off(출시 책임 확인) (통보)
- FPW.7-A09 출시 전이 (통보)
- FPW.9-A05 Lifecycle 종료 전이 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
