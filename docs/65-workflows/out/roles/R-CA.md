---
id: WF-ROLE-CA
type: workflow
title: "SW 개발비 산정 승인자 업무 절차서 / Cost Approver Procedure"
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

# WF-ROLE-CA · SW 개발비 산정 승인자 업무 절차서

> 제출된 산정 과제를 검토해 승인하거나 반려한다. 자기가 만든 과제는 승인하지 않는다(SOD-16).

- IAM 역할: COST_APPROVER(SW 개발비 산정 승인자)
- IAM 데모 계정: approver
- 매핑 근거: 보고서 어휘 밖. 20-94 IAM COST_APPROVER, 데모 계정 approver

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.15-A05 산정 승인·반려 — 수행·책임
- 프로세스: FPW.15 SW 개발비·원가 기준 관리
- 시작: 앞 활동 완료
- 입력: WP-COST-REVIEW, WP-COST-CALC → 출력: WP-COST-REVIEW
- 플랫폼: `costCheckPut`, `costTransition`, `/procurement/sw-cost/:estId`
1. 작성자와 자신이 다른 사람인지 확인한다
2. 범위·공수·단가와 검토 체크를 근거로 승인 또는 반려를 판단한다
3. 사유를 남겨 전이하고 승인 스냅샷 또는 보완 요청을 확인한다
- [ ] 자기 작성 과제의 승인이 차단된다
- [ ] 판정자·사유와 승인 스냅샷이 추적된다

## 2. 협의·통보 받는 활동

- FPW.15-A01 산정 범위 설정 (통보)
- FPW.15-A02 원가 기준 발행 (통보)
- FPW.15-A03 공수·규모 입력 (통보)
- FPW.15-A04 산정 검토 요청 (통보)
- FPW.15-A06 승인 결과 열람·공유 (통보)
- FPW.15-A07 실적·교정 검토 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
