---
id: WF-ROLE-PDA
type: workflow
title: "상품 기획 업무 절차서 / Product Author Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-7
    - WF-FPW-18
last_updated: 2026-11-08
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
- 플랫폼: `createProduct`, `validateComposition`, `checkBillOfFeatures`, `offerTrials`, `/products/new`, `/entitlements`, `/products/bill-of-features`, `/products/configurator`
1. 상품에 넣을 Feature와 판매 방식을 정해 상품을 등록한다
2. 구성 검증으로 Feature 간 의존·배타 충돌이 없는지 확인한다. PASS일 때 등록하고, FAIL은 결과를 확인한 뒤 초안으로만 등록한다
3. Bill-of-Features 점검으로 카탈로그 제약(기준 행 선행·배타, 하위 feature의 상위, 대안 중복)을 보고, 제품 구성기로 켜질 Flag·SW를 미리 본다
4. 체험 제안 조건(대상·기간)을 정한다. 대상은 범위 안 고객 차량만이고 시뮬레이터 차량은 뺀다
- [ ] 구성 검증 결과에 충돌이 없다

### FPW.18-A01 분석 목적·데이터 검토 — 수행·책임
- 프로세스: FPW.18 운영 분석·상품 개선
- 시작: 앞 활동 완료
- 입력: – → 출력: WP-ANALYSIS-SCOPE
- 플랫폼: `/data/workbench`, `/biz/trials`
1. 분석하려는 질문·대상 집단·기간과 필요한 데이터 범주를 정한다
2. DPO·법무와 목적 적합성·가명화·보존 및 국외 이전 근거를 검토한다
3. 확인되지 않은 이용 목적과 접근 제한을 기록하고 허용된 데이터만 요청한다
- [ ] 접근 가능하다는 이유만으로 새로운 이용 목적을 허용하지 않는다
- [ ] 외부 검토의 담당자와 근거가 식별된다

### FPW.18-A03 체험·전환 분석 — 수행·책임
- 프로세스: FPW.18 운영 분석·상품 개선
- 시작: 앞 활동 완료
- 입력: WP-ANALYSIS-SCOPE → 출력: WP-OPS-ANALYSIS
- 플랫폼: `/biz/trials`, `/products`, `/entitlements`
1. 상품·제안 출처·기간과 집단별 분모를 확인한다
2. 수락·거절·만료·구매 전환 지표와 차이를 분석한다
3. 선택 편향·결측과 재현 조건을 적어 개선 가설을 만든다
- [ ] 제안 수와 수락 수 및 구매 수를 혼동하지 않는다
- [ ] 상관관계만으로 인과 효과를 확정하지 않는다

## 2. 협의·통보 받는 활동

- FPW.7-A06 상품 구성 승인 (통보)
- FPW.7-A10 상품 고객 출시 승인 (통보)
- FPW.18-A04 개선 과제 인계 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
