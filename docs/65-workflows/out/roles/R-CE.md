---
id: WF-ROLE-CE
type: workflow
title: "SW 개발비 산정 작성자 업무 절차서 / Cost Estimator Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-15
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-CE · SW 개발비 산정 작성자 업무 절차서

> Feature를 담아 SW 개발비 산정 과제를 만들고 줄 입력·과제 설정을 채워 승인을 요청한다.

- IAM 역할: COST_ESTIMATOR(SW 개발비 산정 작성자)
- IAM 데모 계정: viewer
- 매핑 근거: 보고서 어휘 밖. SW 개발비 산정 설계(20-94, D07-01) IAM COST_ESTIMATOR, 데모 계정 viewer(구매 계정)

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.15-A01 산정 범위 설정 — 수행·책임
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 앞 활동 완료
- 입력: WP-REF-LINK → 출력: WP-COST-SCOPE
- 플랫폼: `costProjectCreate`, `costFeatureAdd`, `costProjectUpdate`, `/procurement/sw-cost`, `/procurement/sw-cost/:estId`
1. 대상 Feature와 기준 행의 버전을 확인한다
2. 차량·시장 범위와 포함·제외 및 가정을 적어 과제를 만든다
3. 작성 책임자와 산정에 사용할 기준 버전을 확인한다
- [ ] 대상과 가정이 과제 설정에 남는다

### FPW.15-A03 공수·규모 입력 — 수행·책임
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 앞 활동 완료
- 입력: WP-COST-SCOPE, WP-COST-BASIS → 출력: WP-COST-CALC
- 플랫폼: `costLineUpdate`, `costMbdPut`, `/procurement/sw-cost/:estId`
1. 과제에 대상 Feature를 담고 입력 행과 중복을 확인한다
2. 규모·복잡도·재사용과 MBD 작업별 공수 근거를 입력한다
3. 오류와 합계를 계산해 기준 버전 및 제외 항목을 재확인한다
- [ ] 필수 입력 오류가 해소되거나 보류 사유가 남는다
- [ ] 줄별 입력과 계산 기준을 재현할 수 있다

### FPW.15-A04 산정 검토 요청 — 수행·책임
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 앞 활동 완료
- 입력: WP-COST-CALC → 출력: WP-COST-REVIEW
- 플랫폼: `costCheckPut`, `costTransition`, `/procurement/sw-cost/:estId`
1. 범위·기준 버전·계산 오류와 검토 체크를 확인한다
2. 불확실한 가정과 제외 항목을 검토 설명에 남긴다
3. 제출 전이를 요청하고 제출 상태와 시각을 확인한다
- [ ] 제출과 미해결 항목이 기록된다

### FPW.15-A07 실적·교정 검토 — 수행
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 승인 뒤 실적 확보
- 입력: WP-COST-REVIEW → 출력: WP-COST-ACTUAL
- 플랫폼: `costActualPut`, `/procurement/sw-cost/:estId`, `/procurement/sw-cost/basis`
1. 승인된 기준 버전과 실적 공수의 수집 범위를 확인한다
2. 실적과 출처를 기록하고 산정 오차 및 교정 제안을 검토한다
3. 다음 기준 개정에 반영할 항목과 보류 사유를 기준 관리자에게 전달한다
- [ ] 실적 입력이 승인 금액을 소급 변경하지 않는다
- [ ] 교정 제안은 기준 개정 전 자동 적용되지 않는다

## 2. 협의·통보 받는 활동

- FPW.15-A02 원가 기준 발행 (협의)
- FPW.15-A05 산정 승인·반려 (통보)
- FPW.15-A06 승인 결과 열람·공유 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
