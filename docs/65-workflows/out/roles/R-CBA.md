---
id: WF-ROLE-CBA
type: workflow
title: "원가 기준 관리자 업무 절차서 / Cost Basis Administrator Procedure"
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

# WF-ROLE-CBA · 원가 기준 관리자 업무 절차서

> 단가·계수 표의 새 버전을 만들고 발행한다. 발행해도 이미 승인된 산정 결과는 바뀌지 않는다.

- IAM 역할: COST_BASIS_ADMIN(원가 기준 관리자)
- IAM 데모 계정: approver
- 매핑 근거: 보고서 어휘 밖. 20-94 IAM COST_BASIS_ADMIN, 데모 계정 approver

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.15-A02 원가 기준 발행 — 수행·책임
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 원가 기준 개정 필요
- 입력: – → 출력: WP-COST-BASIS
- 플랫폼: `costBasisDraft`, `costBasisPublish`, `/procurement/sw-cost/basis`
1. 현행 단가·계수와 출처 및 통화를 확인한다
2. 변경 항목을 새 기준 초안으로 작성한다
3. 사유를 적어 새 기준 버전을 발행하고 적용 대상을 알린다
- [ ] 과거 승인 산정은 발행 전 스냅샷을 유지한다
- [ ] 기준 버전과 변경 사유가 남는다

### FPW.15-A07 실적·교정 검토 — 책임(승인)
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

- 없음

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
