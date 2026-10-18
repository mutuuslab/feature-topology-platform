---
id: WF-ROLE-PDA
type: workflow
title: "상품 기획 업무 절차서 / Product Author Procedure"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-7
last_updated: 2026-10-17
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-PDA · 상품 기획 업무 절차서

> Feature Catalog 상품 구성과 체험 제안을 작성한다.

- IAM 역할: PRODUCT_AUTHOR(상품 작성자)
- IAM 데모 계정: commerce
- 매핑 근거: 보고서 어휘 밖. IAM PRODUCT_AUTHOR, 데모 계정 commerce

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.7-A05 상품 구성 작성 — 수행·책임
- 프로세스: FPW.7 출시·활성화·단계적 확대
- 시작: G6 배포 완료
- 입력: WP-G6-DECISION → 출력: WP-PRODUCT
- 플랫폼: `createProduct`, `validateComposition`, `offerTrials`, `/products/new`, `/entitlements`
1. 상품에 넣을 Feature와 판매 방식을 정해 상품을 등록한다
2. 구성 검증으로 Feature 간 의존·배타 충돌이 없는지 확인한다
3. 체험 제안 조건(대상·기간)을 정한다
- [ ] 구성 검증 결과에 충돌이 없다

## 2. 협의·통보 받는 활동

- FPW.7-A06 상품 구성 승인 (통보)
- FPW.7-A10 상품 고객 출시 승인 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
